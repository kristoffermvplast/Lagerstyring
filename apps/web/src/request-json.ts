/** One attempt only: commands are retried explicitly by their owning form. */
export async function requestJson<T>(url:string,init:RequestInit,request:typeof fetch=fetch):Promise<T>{
 const writing=!['GET','HEAD'].includes((init.method??'GET').toUpperCase());
 if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Ingen netværksforbindelse. Denne forespørgsel er ikke sendt. Behold formularen åben og prøv igen, når forbindelsen er tilbage.');
 const interrupted=()=>new Error(writing?'Forbindelsen blev afbrudt, eller svaret kunne ikke læses. Handlingen kan være gemt. Behold formularen åben og brug dens genforsøg; opret ikke en ny registrering.':'Opslaget kunne ikke hentes. Kontrollér forbindelsen og prøv igen.');
 let response:Response;
 try{response=await request(url,init);}catch{throw interrupted();}
 if(!response.ok)throw new Error(response.status===401?'Din session er udløbet eller tilbagekaldt. Log ud og ind igen.':response.status===403?'Du har ikke adgang til denne handling.':response.status===413?'Resultatet er for stort. Afgræns periode eller filtre og prøv igen.':response.status===409?'Ændringen kunne ikke gemmes. Genindlæs listen; kontrollér dubletter, referencer og rettigheder.':writing&&response.status>=500?'Serverens svar er usikkert. Handlingen kan være gemt. Brug formularens genforsøg og undgå en ny registrering.':'Handlingen kunne ikke gennemføres. Prøv igen.');
 try{return await response.json();}catch{throw interrupted();}
}
