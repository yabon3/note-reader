// 公開時は末尾の空欄に中継役のURLを入れる
export const RELAY_URL = location.hostname === 'localhost' ? 'http://localhost:8787' : '';
