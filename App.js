import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Markdown from 'react-native-markdown-display';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FS from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as LLM from './src/llm';
import { SYSTEM_PROMPT } from './src/config';
import { PdfReader, relevantText, isPdf } from './src/docs';
import { loadChats, saveChats, newChat } from './src/store';

const K = '#000', W = '#fff', G = '#f3f3f3', B = '#e2e2e2';
const SUGGEST = ['Explain a topic simply', 'Make a study table', 'Summarise my PDF', 'Solve a problem step by step'];

export default function App() {
  const [stage, setStage] = useState('boot'); // boot | setup | loading | ready
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [chats, setChats] = useState([]);
  const [cur, setCur] = useState(newChat());
  const [input, setInput] = useState('');
  const [pending, setPending] = useState({ images: [], docs: [] });
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const list = useRef(null); const pdf = useRef(null); const stopped = useRef(false);

  const boot = useCallback(async () => {
    setErr('');
    try {
      setChats(await loadChats());
      if (!(await LLM.isInstalled())) { setStage('setup'); return; }
      setStage('loading'); await LLM.load(); setStage('ready');
    } catch (e) { setErr(String(e.message || e)); setStage('setup'); }
  }, []);
  useEffect(() => { boot(); }, []);

  const runSetup = async () => {
    setErr(''); setProgress(0); setStage('downloading');
    try { await LLM.install(setProgress); await boot(); }
    catch (e) { setErr(String(e.message || e)); setStage('setup'); }
  };

  // ---------- attachments ----------
  const addImage = async (camera) => {
    setAttachMenu(false);
    const fn = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const r = await fn({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (r.canceled) return;
    const m = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 768 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    setPending((p) => ({ ...p, images: [...p.images, m.uri] }));
  };
  const addFile = async () => {
    setAttachMenu(false);
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
    if (r.canceled) return;
    setReading(true);
    for (const a of r.assets) {
      try {
        if ((a.mimeType || '').startsWith('image/')) {
          const m = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 768 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
          setPending((p) => ({ ...p, images: [...p.images, m.uri] }));
        } else if (isPdf(a.name, a.mimeType)) {
          const text = await pdf.current.extract(a.uri);
          if (text.replace(/\[Page \d+\]/g, '').trim().length < 20) throw new Error('No readable text (scanned PDF?). Send pages as photos instead.');
          setPending((p) => ({ ...p, docs: [...p.docs, { name: a.name, text }] }));
        } else {
          const text = await FS.readAsStringAsync(a.uri);
          setPending((p) => ({ ...p, docs: [...p.docs, { name: a.name, text }] }));
        }
      } catch (e) { Alert.alert('Could not read ' + a.name, String(e.message || e)); }
    }
    setReading(false);
  };

  // ---------- send ----------
  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if ((!text && !pending.images.length && !pending.docs.length) || busy) return;
    const userMsg = { id: 'u' + Date.now(), role: 'user', text: text || 'Please look at what I attached.', images: pending.images, files: pending.docs.map((d) => d.name) };
    const botMsg = { id: 'a' + Date.now(), role: 'assistant', text: '' };
    const docs = [...cur.docs, ...pending.docs];
    let chat = { ...cur, docs, messages: [...cur.messages, userMsg, botMsg], title: cur.messages.length ? cur.title : userMsg.text.slice(0, 40) };
    setCur(chat); setInput(''); setPending({ images: [], docs: [] }); setBusy(true); stopped.current = false;
    activateKeepAwakeAsync();

    // build prompt: system + file excerpts + recent history
    let sys = SYSTEM_PROMPT;
    if (docs.length) sys += '\n\nFILES PROVIDED BY THE USER:\n' + relevantText(docs, userMsg.text);
    const hist = cur.messages.slice(-6).map((m) => ({ role: m.role, content: m.text + (m.images?.length ? ' [image was attached]' : '') }));
    const content = [{ type: 'text', text: userMsg.text }, ...userMsg.images.map((u) => ({ type: 'image_url', image_url: { url: u } }))];
    const msgs = [{ role: 'system', content: sys }, ...hist, { role: 'user', content: userMsg.images.length ? content : userMsg.text }];

    let acc = '';
    try {
      await LLM.generate(msgs, (t) => {
        acc += t;
        setCur((c) => ({ ...c, messages: c.messages.map((m) => (m.id === botMsg.id ? { ...m, text: acc } : m)) }));
      });
    } catch (e) { acc = acc || 'Something went wrong. Please try again.'; }
    chat = { ...chat, messages: chat.messages.map((m) => (m.id === botMsg.id ? { ...m, text: acc.trim() || '…' } : m)) };
    setCur(chat); setBusy(false); deactivateKeepAwake();
    const all = [chat, ...chats.filter((c) => c.id !== chat.id)];
    setChats(all); saveChats(all);
  };

  const openChat = (c) => { setCur(c); setMenu(false); };
  const startNew = () => { if (busy) return; setCur(newChat()); setPending({ images: [], docs: [] }); setMenu(false); };
  const del = (id) => { const all = chats.filter((c) => c.id !== id); setChats(all); saveChats(all); if (cur.id === id) setCur(newChat()); };

  // ---------- screens ----------
  if (stage !== 'ready') {
    return (
      <SafeAreaProvider><SafeAreaView style={[s.fill, s.center]}>
        <StatusBar style="dark" />
        <Text style={s.logo}>Mind</Text>
        {stage === 'boot' || stage === 'loading' ? (<><ActivityIndicator color={K} style={{ marginTop: 24 }} /><Text style={s.sub}>{stage === 'loading' ? 'Waking up…' : ''}</Text></>) : null}
        {stage === 'setup' && (<>
          <Text style={s.sub}>One-time setup. Needs about 3.5 GB and Wi‑Fi.{'\n'}After this, Mind works fully offline.</Text>
          {!!err && <Text style={s.err}>{err}</Text>}
          <TouchableOpacity style={s.btn} onPress={runSetup}><Text style={s.btnT}>Set up Mind</Text></TouchableOpacity>
        </>)}
        {stage === 'downloading' && (<>
          <View style={s.bar}><View style={[s.barIn, { width: `${Math.round(progress * 100)}%` }]} /></View>
          <Text style={s.sub}>{Math.round(progress * 100)}% — keep the app open</Text>
        </>)}
      </SafeAreaView></SafeAreaProvider>
    );
  }

  const md = { body: { color: K, fontSize: 16, lineHeight: 24 }, code_inline: { backgroundColor: G, color: K }, code_block: { backgroundColor: G, color: K, padding: 10, borderRadius: 8 },
    fence: { backgroundColor: G, color: K, padding: 10, borderRadius: 8 }, table: { borderColor: K, borderWidth: 1, borderRadius: 6 }, th: { padding: 8, fontWeight: '700' }, td: { padding: 8 },
    tr: { borderColor: B }, heading1: { color: K }, heading2: { color: K }, heading3: { color: K }, link: { color: K }, blockquote: { backgroundColor: G, borderColor: K } };

  return (
    <SafeAreaProvider><SafeAreaView style={s.fill}>
      <StatusBar style="dark" />
      <PdfReader ref={pdf} />
      <View style={s.head}>
        <TouchableOpacity onPress={() => setMenu(true)} style={s.hb}><Text style={s.hbT}>☰</Text></TouchableOpacity>
        <Text style={s.title}>Mind</Text>
        <TouchableOpacity onPress={startNew} style={s.hb}><Text style={s.hbT}>＋</Text></TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {cur.messages.length === 0 ? (
          <View style={[s.fill, s.center]}>
            <Text style={s.hello}>What's on your mind?</Text>
            <View style={s.chips}>{SUGGEST.map((t) => (<TouchableOpacity key={t} style={s.chip} onPress={() => setInput(t)}><Text style={s.chipT}>{t}</Text></TouchableOpacity>))}</View>
          </View>
        ) : (
          <FlatList ref={list} data={cur.messages} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: m }) => m.role === 'user' ? (
              <View style={s.uWrap}>
                {m.images?.map((u) => <Image key={u} source={{ uri: u }} style={s.img} />)}
                {m.files?.map((f) => <Text key={f} style={s.fileTag}>📄 {f}</Text>)}
                <View style={s.uBub}><Text style={s.uT}>{m.text}</Text></View>
              </View>
            ) : (
              <View style={{ marginBottom: 18 }}>
                {m.text ? <Markdown style={md}>{m.text}</Markdown> : <ActivityIndicator color={K} style={{ alignSelf: 'flex-start' }} />}
              </View>
            )} />
        )}

        {(pending.images.length > 0 || pending.docs.length > 0 || reading) && (
          <ScrollView horizontal style={s.pend} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 12 }}>
            {pending.images.map((u) => (<TouchableOpacity key={u} onPress={() => setPending((p) => ({ ...p, images: p.images.filter((x) => x !== u) }))}><Image source={{ uri: u }} style={s.thumb} /></TouchableOpacity>))}
            {pending.docs.map((d) => (<TouchableOpacity key={d.name} style={s.doc} onPress={() => setPending((p) => ({ ...p, docs: p.docs.filter((x) => x !== d) }))}><Text numberOfLines={1} style={s.docT}>📄 {d.name}  ✕</Text></TouchableOpacity>))}
            {reading && <ActivityIndicator color={K} />}
          </ScrollView>
        )}

        <View style={s.bar2}>
          <TouchableOpacity style={s.round} onPress={() => setAttachMenu(true)}><Text style={s.roundT}>＋</Text></TouchableOpacity>
          <TextInput style={s.input} value={input} onChangeText={setInput} placeholder="Message" placeholderTextColor="#888" multiline />
          {busy ? (
            <TouchableOpacity style={[s.round, s.dark]} onPress={() => { stopped.current = true; LLM.stop(); }}><Text style={[s.roundT, { color: W }]}>■</Text></TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.round, s.dark]} onPress={() => send()}><Text style={[s.roundT, { color: W }]}>↑</Text></TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal visible={attachMenu} transparent animationType="fade" onRequestClose={() => setAttachMenu(false)}>
        <TouchableOpacity style={s.scrim} activeOpacity={1} onPress={() => setAttachMenu(false)}>
          <View style={s.sheet}>
            {[['📷  Camera', () => addImage(true)], ['🖼  Photos', () => addImage(false)], ['📎  Files & PDFs', addFile]].map(([t, f]) => (
              <TouchableOpacity key={t} style={s.row} onPress={f}><Text style={s.rowT}>{t}</Text></TouchableOpacity>))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={menu} animationType="slide" onRequestClose={() => setMenu(false)}>
        <SafeAreaView style={s.fill}>
          <View style={s.head}><TouchableOpacity onPress={() => setMenu(false)} style={s.hb}><Text style={s.hbT}>✕</Text></TouchableOpacity><Text style={s.title}>History</Text><View style={s.hb} /></View>
          <FlatList data={chats} keyExtractor={(c) => c.id} ListEmptyComponent={<Text style={[s.sub, { marginTop: 40 }]}>No chats yet</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.hrow} onPress={() => openChat(item)} onLongPress={() => Alert.alert('Delete chat?', item.title, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => del(item.id) }])}>
                <Text numberOfLines={1} style={s.rowT}>{item.title}</Text>
              </TouchableOpacity>)} />
          <Text style={[s.sub, { padding: 12 }]}>Long-press a chat to delete</Text>
        </SafeAreaView>
      </Modal>
    </SafeAreaView></SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: W }, center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 44, fontWeight: '800', color: K, letterSpacing: -1 },
  sub: { color: '#555', textAlign: 'center', marginTop: 16, lineHeight: 21 }, err: { color: K, marginTop: 14, textAlign: 'center', fontWeight: '600' },
  btn: { backgroundColor: K, paddingVertical: 14, paddingHorizontal: 34, borderRadius: 30, marginTop: 28 }, btnT: { color: W, fontWeight: '700', fontSize: 16 },
  bar: { height: 6, width: '70%', backgroundColor: B, borderRadius: 3, marginTop: 28, overflow: 'hidden' }, barIn: { height: 6, backgroundColor: K },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 52, borderBottomWidth: 1, borderColor: B },
  hb: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, hbT: { fontSize: 22, color: K }, title: { fontSize: 18, fontWeight: '700', color: K },
  hello: { fontSize: 26, fontWeight: '700', color: K }, chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 22 },
  chip: { borderWidth: 1, borderColor: K, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, margin: 4 }, chipT: { color: K },
  uWrap: { alignItems: 'flex-end', marginBottom: 16 }, uBub: { backgroundColor: K, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '85%' }, uT: { color: W, fontSize: 16, lineHeight: 22 },
  img: { width: 160, height: 160, borderRadius: 12, marginBottom: 6 }, fileTag: { color: K, marginBottom: 6, fontSize: 13 },
  pend: { maxHeight: 76, borderTopWidth: 1, borderColor: B }, thumb: { width: 56, height: 56, borderRadius: 10, marginRight: 8 },
  doc: { borderWidth: 1, borderColor: K, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8, maxWidth: 220 }, docT: { color: K, fontSize: 13 },
  bar2: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderColor: B },
  input: { flex: 1, maxHeight: 130, backgroundColor: G, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, marginHorizontal: 8, fontSize: 16, color: K },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: K, alignItems: 'center', justifyContent: 'center' }, dark: { backgroundColor: K }, roundT: { fontSize: 22, color: K },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }, sheet: { backgroundColor: W, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 8 },
  row: { padding: 18 }, rowT: { fontSize: 17, color: K }, hrow: { padding: 18, borderBottomWidth: 1, borderColor: B },
});
