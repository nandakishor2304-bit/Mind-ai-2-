import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FS from 'expo-file-system';
import { DOC_BUDGET_CHARS } from './config';

// Pick relevant chunks so big files fit the phone's context window.
export function relevantText(docs, query) {
  const total = docs.reduce((s, d) => s + d.text.length, 0);
  if (total <= DOC_BUDGET_CHARS) return docs.map((d) => `### ${d.name}\n${d.text}`).join('\n\n');
  const words = (query.toLowerCase().match(/[a-z0-9\u0900-\u0dff]{3,}/g) || []);
  const chunks = [];
  docs.forEach((d) => {
    for (let i = 0; i < d.text.length; i += 900) {
      const t = d.text.slice(i, i + 900), l = t.toLowerCase();
      const score = words.reduce((s, w) => s + (l.includes(w) ? 1 : 0), 0) + (i === 0 ? 0.5 : 0);
      chunks.push({ name: d.name, i, t, score });
    }
  });
  chunks.sort((a, b) => b.score - a.score);
  let used = 0; const pick = [];
  for (const c of chunks) { if (used + c.t.length > DOC_BUDGET_CHARS) continue; pick.push(c); used += c.t.length; }
  pick.sort((a, b) => a.name.localeCompare(b.name) || a.i - b.i);
  return pick.map((c) => `### ${c.name} (excerpt)\n${c.t}`).join('\n\n');
}

export const isPdf = (n, m) => /\.pdf$/i.test(n) || m === 'application/pdf';

let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const rd = async (m) => { const a = Asset.fromModule(m); await a.downloadAsync(); return FS.readAsStringAsync(a.localUri); };
  libs = { pdf: await rd(require('../assets/pdfjs/pdf.txt')), worker: await rd(require('../assets/pdfjs/worker.txt')) };
  return libs;
}

// Offline PDF reader: pdf.js inside a hidden WebView.
export const PdfReader = forwardRef((_, ref) => {
  const web = useRef(null); const pending = useRef(null); const ready = useRef(false);
  const [html, setHtml] = React.useState(null);
  React.useEffect(() => { loadLibs().then((l) => setHtml(
`<!doctype html><html><body><script>${l.pdf}</script><script>
const WORKER=${JSON.stringify(l.worker)};
pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([WORKER],{type:'text/javascript'}));
window.run=async function(b64){try{
 const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
 const pdf=await pdfjsLib.getDocument({data:u}).promise;let out='';
 for(let p=1;p<=pdf.numPages;p++){const pg=await pdf.getPage(p);const c=await pg.getTextContent();
  out+='\\n[Page '+p+']\\n'+c.items.map(i=>i.str).join(' ');}
 ReactNativeWebView.postMessage(JSON.stringify({ok:true,text:out}));
}catch(e){ReactNativeWebView.postMessage(JSON.stringify({ok:false,err:String(e)}));}};
ReactNativeWebView.postMessage(JSON.stringify({ready:true}));
</script></body></html>`)).catch(() => {}); }, []);

  useImperativeHandle(ref, () => ({
    extract: (uri) => new Promise(async (resolve, reject) => {
      try {
        let tries = 0;
        while (!ready.current && tries++ < 80) await new Promise((r) => setTimeout(r, 150));
        if (!ready.current) throw new Error('PDF reader not ready');
        const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
        pending.current = { resolve, reject };
        web.current.injectJavaScript(`window.run(${JSON.stringify(b64)});true;`);
      } catch (e) { reject(e); }
    }),
  }));

  if (!html) return null;
  return (
    <WebView ref={web} originWhitelist={['*']} source={{ html, baseUrl: 'https://localhost/' }}
      style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} javaScriptEnabled
      onMessage={(e) => {
        const m = JSON.parse(e.nativeEvent.data);
        if (m.ready) { ready.current = true; return; }
        const p = pending.current; pending.current = null;
        if (!p) return;
        m.ok ? p.resolve(m.text) : p.reject(new Error(m.err));
      }} />
  );
});
