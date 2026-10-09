'use client';
import { useEffect, useRef } from 'react';
import { emotions, emotionLabels } from '@/lib/desire/emotion-keys';
export function DesireSea({ data }: { data: Record<string,unknown> | null }) {
  const ref=useRef<HTMLCanvasElement>(null);
  const values=data?.values as Record<string,number>|undefined;
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    let frame=0;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)');
    const draw=()=>{
      const width=640,height=340,dpr=Math.min(2,devicePixelRatio||1);
      canvas.width=width*dpr;canvas.height=height*dpr;ctx.scale(dpr,dpr);
      const dark=canvas.closest('[data-home-theme]')?.getAttribute('data-home-theme')==='black';
      const t=reduce.matches?0:performance.now()/1000;
      const shore=(x:number)=>{
        const u=Math.max(0,Math.min(7,x/width*8-.5)),i=Math.min(6,Math.floor(u)),s=u-i,e=s*s*(3-2*s);
        const v=(values?.[emotions[i]]??0)*(1-e)+(values?.[emotions[i+1]]??0)*e;
        const cycle=t%9/9,run=reduce.matches?0:Math.sin(Math.PI*(cycle<.65?cycle/.65*.5:.5+(cycle-.65)/.35*.5))*13;
        return height*(.62-v*.0038)-run+Math.sin(x*.027)*2.8;
      };
      const path=(offset=0)=>{ctx.beginPath();for(let x=0;x<=width;x+=2){const y=shore(x)+offset;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}};
      const sand=ctx.createLinearGradient(0,0,width,height);sand.addColorStop(0,dark?'#172c3a':'#f2f2e8');sand.addColorStop(1,dark?'#263943':'#d4e1dc');ctx.fillStyle=sand;ctx.fillRect(0,0,width,height);
      path();ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();const water=ctx.createLinearGradient(0,height*.25,0,height);water.addColorStop(0,dark?'#366675':'#a8d1cf');water.addColorStop(.5,dark?'#143b53':'#599eae');water.addColorStop(1,dark?'#0b1a30':'#265e7d');ctx.fillStyle=water;ctx.fill();ctx.save();ctx.clip();
      for(let i=0;i<4;i++){const p=(t/9+i/4)%1;path((1-p)*height*.85);ctx.strokeStyle=`rgba(255,255,255,${.05+p*.14})`;ctx.lineWidth=1+p;ctx.stroke();}
      ctx.restore();path();ctx.strokeStyle='#ffffffaa';ctx.lineWidth=2;ctx.stroke();
      ctx.textAlign='center';emotions.forEach((key,i)=>{const x=width*(i+.5)/8;ctx.fillStyle=dark?'#e3f0f5':'#294a57';ctx.font='20px Georgia';ctx.fillText(values?.[key]?.toString()??'—',x,shore(x)-20);ctx.fillStyle='#ffffffe6';ctx.font='17px serif';ctx.fillText(emotionLabels[i],x,height-20);});
      if(!reduce.matches&&!document.hidden)frame=requestAnimationFrame(draw);
    };
    const resume=()=>{cancelAnimationFrame(frame);draw();};resume();document.addEventListener('visibilitychange',resume);reduce.addEventListener('change',resume);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',resume);reduce.removeEventListener('change',resume);};
  },[values]);
  return <canvas ref={ref} className="desire-sea" role="img" aria-label={emotions.map((key,i)=>`${emotionLabels[i]} ${values?.[key]??'待评估'}`).join('，')}/>;
}
