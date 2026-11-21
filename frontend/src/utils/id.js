// crypto.randomUUID is only available in secure contexts. The store console
// and warehouse tools also run on plain-HTTP LAN addresses during on-site
// testing, where calling it throws and can leave a form stuck mid-action.
export const newId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};
