// Strict, bounded UTF-8 CSV; Excel users save as CSV UTF-8. Never evaluate cells.
export function parseImportCsv(text:string):{headers:string[];rows:Record<string,string>[]} {
 if(Buffer.byteLength(text,'utf8')>32768||text.includes('\0')||text.includes('\uFFFD'))throw new Error('Filen skal være gyldig UTF-8 og højst 32 KB.');
 text=text.replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/,1)[0]??'', delimiter=first.includes(';')?';':',';
 const records:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const pushCell=()=>{row.push(cell);cell='';closed=false;};
 const pushRow=()=>{pushCell();records.push(row);row=[];if(records.length>101)throw new Error('Højst 100 datarækker pr. fil.');};
 for(let i=0;i<text.length;i++){
  const c=text[i]!;
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===delimiter){pushCell();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();continue;}
  if(closed)throw new Error('Ugyldigt tegn efter afsluttende citationstegn.');
  if(c==='"'){if(cell)throw new Error('Ugyldigt citationstegn.');quoted=true;}else cell+=c;
 }
 if(quoted)throw new Error('Et citationstegn mangler.');
 if(cell||row.length||closed)pushRow();
 const headers=records.shift()?.map(h=>h.trim())??[];
 if(!headers.length||new Set(headers).size!==headers.length||headers.some(h=>! /^[a-z_]+$/.test(h)))throw new Error('Kolonnenavne mangler, er ugyldige eller gentaget. Brug skabelonen.');
 if(!records.length)throw new Error('Filen indeholder ingen datarækker.');
 return {headers,rows:records.map((r,i)=>{if(r.length!==headers.length)throw new Error(`Række ${i+2}: forkert antal kolonner.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j]!.trim()]));})};
}
