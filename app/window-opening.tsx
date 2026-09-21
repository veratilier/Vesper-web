"use client";
import { useEffect, useRef, useState } from "react";
import "./window-opening.css";
const LAYERS = ["/opening/sky-v5.png", "/opening/castle-v7.png", "/opening/trees-v7.png", "/opening/window-v7.png", "/opening/desk-v7.png"];
export function WindowOpening() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [hold, setHold] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {setReduced(query.matches); if(query.matches) setHold(true);};
    change(); query.addEventListener("change", change);
    let cancelled = false;
    // Decode the displayed elements, not duplicate preload objects. A downloaded
    // PNG can still need decoding before the browser can paint it.
    const plates = Array.from(node?.querySelectorAll<HTMLImageElement>(".opening-plate") || []);
    Promise.allSettled(plates.map(img => img.decode())).then(results => {
      if (cancelled) return;
      setReady(true);
      if (results.some(result => result.status === "rejected")) setHold(true);
    });
    // A stalled image request exposes the entry button, never auto-enters the app.
    const fallback = setTimeout(()=>{if(!cancelled) setHold(true);},15000);
    return ()=>{cancelled=true;clearTimeout(fallback);query.removeEventListener("change",change);node?.close();};
  },[]);
  useEffect(()=>{
    if(!ready) return;
    const timer=setTimeout(()=>setHold(true),850);
    return ()=>clearTimeout(timer);
  },[ready]);
  useEffect(()=>{
    if(!leaving) return;
    const timer=setTimeout(()=>{dialog.current?.close();setVisible(false);},reduced?0:350);
    return ()=>clearTimeout(timer);
  },[leaving,reduced]);
  if(!visible) return null;
  return <dialog ref={dialog} className={`window-opening${ready?' opening-ready':''}${hold?' opening-hold':''}${reduced?' opening-reduced':''}${leaving?' opening-leaving':''}`} aria-label="Vesper opening" onCancel={e=>{e.preventDefault();setLeaving(true);}}>
    <div className="opening-art" aria-hidden="true">
      {LAYERS.map((src,i)=><img key={src} src={src} className={`opening-plate opening-depth-${i}`} alt="" draggable={false} loading="eager" fetchPriority={i===0?"high":"auto"}/>)}
    </div>
    <div className="opening-dedication">
      <h1 className="opening-title">Vesper</h1>
      <p className="opening-subtitle">Somewhere we belong.</p>
    </div>
    <button className="opening-enter" disabled={!hold || leaving} onClick={()=>setLeaving(true)}>Enter Vesper <span aria-hidden="true">›</span></button>
  </dialog>;
}
