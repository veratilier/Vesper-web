/** Advertise the event extension in both supported MCP handshake responses. */
export function advertiseEvents(body:string,contentType:string):string {
  const update=(value:string)=>{
    const packet=JSON.parse(value);
    if(!packet.result?.capabilities || typeof packet.result.capabilities!=='object') return value;
    packet.result.capabilities.events={};
    return JSON.stringify(packet);
  };
  return contentType.includes('text/event-stream') ? body.replace(/^(data:\s*)(.+)$/m,(_,prefix,value)=>prefix+update(value)) : update(body);
}
