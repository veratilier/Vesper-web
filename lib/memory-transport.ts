// Experimental app-server transport: enable only after checking the deployed VPS schema.
// Each value is bounded below the host's 1,000-token fragment truncation ceiling by
// UTF-8 bytes (byte-fallback tokenization cannot exceed one token per byte).
export function memoryAdditionalContext(context:string) {
 const parts:string[]=[];let part='',bytes=0;
 for(const char of context){const size=new TextEncoder().encode(char).length;if(bytes+size>768){parts.push(part);part='';bytes=0;}part+=char;bytes+=size;}
 if(part)parts.push(part);
 return Object.fromEntries(parts.map((value,index)=>['vesper_memory_'+String(index).padStart(3,'0'),{kind:'untrusted' as const,value}]));
}
