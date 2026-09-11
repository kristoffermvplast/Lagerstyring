import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Injectable, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { APP_CONFIG, Actor, AuthRequired } from './auth';
import { AppConfig } from './config';
import { DatabaseService } from './database';
const MAX_BYTES=1024*1024;
const bucket='item-photos';
const identifiers=z.object({company:z.string().uuid(),id:z.string().uuid(),kind:z.enum(['product','material','packaging'])});
const input=z.object({version:z.number().int().positive(),mime:z.enum(['image/png','image/jpeg']),base64:z.string().max(Math.ceil(MAX_BYTES/3)*4)}).strict();
export function validatePhoto(base64:string,mime:string):Buffer {
 if(!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new BadRequestException();
 const data=Buffer.from(base64,'base64');
 if(data.length>MAX_BYTES || data.toString('base64')!==base64)throw new BadRequestException();
 const png=data.length>=33 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString('ascii',12,16)==='IHDR' && data.readUInt32BE(16)>0 && data.readUInt32BE(20)>0 && data.readUInt32BE(16)<=4096 && data.readUInt32BE(20)<=4096;
 let jpeg=false;
 if(data.length>=4 && data[0]===255 && data[1]===216 && data[data.length-2]===255 && data[data.length-1]===217) {
  let offset=2;
  while(offset+4<=data.length) {
   if(data[offset]!==255)break;
   const marker=data[offset+1]!,length=data.readUInt16BE(offset+2);
   if(length<2 || offset+2+length>data.length || marker===0xda || marker===0xd9)break;
   if([0xc0,0xc1,0xc2].includes(marker) && length>=8) {
    const height=data.readUInt16BE(offset+5),width=data.readUInt16BE(offset+7);
    jpeg=height>0 && width>0 && height<=4096 && width<=4096;break;
   }
   offset+=2+length;
  }
 }
 if((mime==='image/png'&&!png)||(mime==='image/jpeg'&&!jpeg)||!['image/png','image/jpeg'].includes(mime))throw new BadRequestException();
 return data;
}
@Injectable()
export class ItemPhotoStorage {
 constructor(@Inject(APP_CONFIG) private readonly config:AppConfig){}
 get enabled(){return this.config.ITEM_PHOTOS_ENABLED;}
 private async request(path:string,method:string,body?:Uint8Array|string,mime?:string) {
  if(!this.enabled)throw new ServiceUnavailableException();
  try {
   const r=await fetch(`${this.config.SUPABASE_URL}/storage/v1/${path}`,{method,headers:{apikey:this.config.SUPABASE_STORAGE_SECRET_KEY,...(mime?{'Content-Type':mime}:{})},...(body!==undefined?{body:body as BodyInit}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw new Error();return r;
  }catch{throw new ServiceUnavailableException();}
 }
 private async requirePrivateBucket(){
  const response=await this.request(`bucket/${bucket}`,'GET');
  const config=await response.json();
  if(config.id!==bucket || config.public!==false)throw new ServiceUnavailableException();
 }
 async upload(key:string,data:Buffer,mime:string){await this.requirePrivateBucket();await this.request(`object/${bucket}/${key}`,'POST',data,mime);}
 async read(key:string){
  await this.requirePrivateBucket();
  const response=await this.request(`object/authenticated/${bucket}/${key}`,'GET');
  const reader=response.body?.getReader();if(!reader)throw new ServiceUnavailableException();
  const chunks:Buffer[]=[];let total=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BYTES)throw new ServiceUnavailableException();chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  return Buffer.concat(chunks);
 }
}
@AuthRequired()
@Controller('companies/:companyId/items/:kind/:id/photo')
export class ItemPhotosController {
 constructor(@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(ItemPhotoStorage) private readonly storage:ItemPhotoStorage){}
 private async run<T>(actor:Actor,company:string,kind:string,id:string,write:boolean,work:(client:any,row:any)=>Promise<T>){
  if(!identifiers.safeParse({company,kind,id}).success)throw new BadRequestException();
  return this.database.asActor(actor,company,async client=>{
   const rights=await client.query("select app.allowed('masterdata.read') as read,app.allowed('masterdata.manage') as manage");
   if(!rights.rows[0]?.read||(write&&!rights.rows[0]?.manage))throw new ForbiddenException();
   const result=await client.query(`select * from app.items where company_id=$1 and kind=$2 and id=$3${write?' for update':''}`,[company,kind,id]);
   if(!result.rowCount)throw new NotFoundException();return work(client,result.rows[0]);
  });
 }
 @Get()
 async get(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') kind:string,@Param('id') id:string){
  return this.run(req.actor,company,kind,id,false,async(_client,row)=>{
   if(!this.storage.enabled)return {enabled:false,photo:null};
   if(!row.photo_key)return {enabled:true,photo:null};
   const data=await this.storage.read(row.photo_key),mime=row.photo_key.endsWith('.png')?'image/png':'image/jpeg';
   validatePhoto(data.toString('base64'),mime);
   return {enabled:true,photo:{mime,base64:data.toString('base64')}};
  });
 }
 @Post()
 async upload(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') kind:string,@Param('id') id:string,@Body() body:unknown){
  const parsed=input.safeParse(body);if(!parsed.success)throw new BadRequestException();
  const data=validatePhoto(parsed.data.base64,parsed.data.mime);
  return this.run(req.actor,company,kind,id,true,async(client,row)=>{
   if(row.version!==parsed.data.version)throw new ConflictException();
   const key=`${company}/${id}/${randomUUID()}.${parsed.data.mime==='image/png'?'png':'jpg'}`;
   // Immutable objects: a failed/ambiguous commit may leave an orphan, never delete a possibly committed photo.
   await this.storage.upload(key,data,parsed.data.mime);
   return (await client.query('update app.items set photo_key=$1,version=version+1 where company_id=$2 and id=$3 returning id,version',[key,company,id])).rows[0];
  });
 }
}
