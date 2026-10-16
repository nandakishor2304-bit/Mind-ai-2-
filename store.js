import * as FS from 'expo-file-system';
const F = FS.documentDirectory + 'chats.json';
export async function loadChats() {
  try { return JSON.parse(await FS.readAsStringAsync(F)); } catch { return []; }
}
export async function saveChats(chats) {
  try { await FS.writeAsStringAsync(F, JSON.stringify(chats.slice(0, 100))); } catch {}
}
export const newChat = () => ({ id: String(Date.now()), title: 'New chat', messages: [], docs: [] });
