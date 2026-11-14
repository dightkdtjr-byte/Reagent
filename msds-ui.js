'use strict';
(() => {
  const MAX_DOCUMENTS = 20;
  const formatSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1024)) + ' KB';
  const stamp = s => { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', {hour12: false}) : ''; };
  // 품목에서 문서를 떼고, 다른 품목이 같은 문서를 쓰지 않으면 PDF 파일(원본·백업 사본)도 지운다.
  async function removeDocument(item, doc, {getItems, save}) {
    const before = item.msdsDocuments, beforeGhs = item.ghs, beforeUpdated = item.updatedAt;
    item.msdsDocuments = (item.msdsDocuments || []).filter(d => d.id !== doc.id); item.updatedAt = new Date().toISOString();
    for (const key of ['safetyInfo', 'safetyReferenceInfo']) if (item[key] && item[key].documentId === doc.id) delete item[key];
    if (item.ghs && item.ghs.extractedFrom && item.ghs.extractedFrom.documentId === doc.id) { item.ghs = {...item.ghs}; delete item.ghs.extractedFrom; }
    let ok = false; try { ok = await save(); } catch {}
    if (!ok) { if (before === undefined) delete item.msdsDocuments; else item.msdsDocuments = before; if (beforeGhs === undefined) delete item.ghs; else item.ghs = beforeGhs; item.updatedAt = beforeUpdated; throw new Error('저장하지 못해 되돌렸습니다.'); }
    // 다른 품목(폐기 품목 포함)이 같은 파일을 쓰는지 모르면 파일은 지우지 않는다.
    if (typeof getItems !== 'function') return {fileDeleted: false, shared: true};
    const shared = getItems().some(r => r.id !== item.id && (r.msdsDocuments || []).some(d => d.sha256 === doc.sha256));
    if (shared || !window.inventoryMSDS?.delete) return {fileDeleted: false, shared};
    const r = await window.inventoryMSDS.delete(doc);
    if (!r?.ok) throw new Error(r?.error || '파일 삭제 실패');
    return {fileDeleted: true, shared: false};
  }
  window.MSDSUI = {
    removeDocument,
    mount({element, itemId, getItem, getItems, save, toast, confirm}) {
      if (!element) return;
      let busy = false, request = 0;
      const alive = () => element.isConnected && !!getItem(itemId);
      const button = (text, fn, className = 'ghost') => {
        const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.onclick = fn; return b;
      };
      function lock(on) { busy = on; element.setAttribute('aria-busy', String(on)); for (const b of element.querySelectorAll('button')) b.disabled = on || b.dataset.unavailable === '1'; }
      async function action(fn) {
        if (busy || !alive()) return;
        lock(true);
        try { await fn(); } catch (e) { toast('MSDS 처리 실패: ' + String(e.message || e), true); }
        finally { if (alive()) { lock(false); await draw(); } }
      }
      async function commit(docs) {
        if (!alive()) return false;
        const item = getItem(itemId), previous = item.msdsDocuments, updated = item.updatedAt, links = {safetyInfo:item.safetyInfo,safetyReferenceInfo:item.safetyReferenceInfo};
        item.msdsDocuments = docs; item.updatedAt = new Date().toISOString();
        for (const key of Object.keys(links)) if (item[key] && !docs.some(d=>d.id===item[key].documentId)) delete item[key];
        let ok=false;try { ok=await save(); } catch {}
        if (!ok) {
          const latest = getItem(itemId);
          if (latest) { if (previous === undefined) delete latest.msdsDocuments; else latest.msdsDocuments = previous; latest.updatedAt = updated; for (const [key,value] of Object.entries(links)) {if(value===undefined)delete latest[key];else latest[key]=value;} }
          throw new Error('문서 연결을 저장하지 못했습니다. 첨부 목록을 되돌렸습니다.');
        }
        window.InventorySafetyUI?.refresh();
        return true;
      }
      async function attach() {
        await action(async () => {
          const result = await window.inventoryMSDS.choose();
          if (!result?.ok) throw new Error(result?.error || '파일 선택 실패');
          if (result.canceled || !alive()) return;
          const item = getItem(itemId), before = item.msdsDocuments || [], ids = new Set(before.map(d => d.id));
          const additions = (result.documents || []).filter(d => !ids.has(d.id));
          if (before.length + additions.length > MAX_DOCUMENTS) throw new Error('품목당 20개까지만 연결할 수 있습니다. 연결을 해제하거나 더 적은 파일을 선택해주세요.');
          const errors = (result.errors || []).map(e => e.fileName + ': ' + e.error);
          if ((result.documents || []).length) {
            if (!await commit([...before, ...additions])) return;
            toast(additions.length ? `MSDS ${additions.length}개를 연결하고 저장했습니다.` : '이미 연결된 문서입니다. 저장된 파일을 다시 확인했습니다.');
            const picked = additions.length ? additions : (result.documents || []);
            if (picked.length) setTimeout(() => { try { window.GHSUI?.onDocumentsAttached?.(itemId, picked); } catch (e) { console.error(e); } }, 50);
          }
          if (errors.length) toast(`첨부하지 못한 파일 ${errors.length}개 — ${errors.slice(0, 2).join(' / ')}`, true);
        });
      }
      async function open(doc) { await action(async () => { const r = await window.inventoryMSDS.open(doc); if (!r?.ok) throw new Error(r?.error || 'PDF 열기 실패'); }); }
      async function preview(doc) { await action(async () => { if (!window.inventoryMSDS.preview) throw new Error('미리보기는 설치형 앱에서 사용할 수 있습니다.'); const r = await window.inventoryMSDS.preview(doc); if (!r?.ok) throw new Error(r?.error || 'PDF 미리보기 실패'); }); }
      async function exportDoc(doc) { await action(async () => { const role=window.InventorySafetyCommon?.linkRole(getItem(itemId),doc); const fileName=role==='reference'||role==='stale'?'REFERENCE_'+doc.fileName.replace(/^REFERENCE_/, ''):doc.fileName; const r = await window.inventoryMSDS.export({...doc,fileName}); if (!r?.ok) throw new Error(r?.error || 'PDF 저장 실패'); if (!r.canceled) toast('MSDS PDF 사본을 저장했습니다.'); }); }
      async function unlink(doc) {
        if (busy || !confirm(`이 MSDS를 삭제할까요?\n\n${doc.fileName}\n\n품목에서 떼어내고, 다른 품목이 쓰지 않는 파일이면 PDF 원본과 백업 사본도 지웁니다.\n(예전 백업을 불러와도 이 PDF는 돌아오지 않습니다.)`)) return;
        await action(async () => { const r = await removeDocument(getItem(itemId), doc, {getItems, save}); toast(r.fileDeleted ? 'MSDS를 삭제했습니다 (PDF 파일 포함).' : r.shared ? 'MSDS를 이 품목에서 뗐습니다. 다른 품목이 쓰는 파일이라 PDF는 남겨두었습니다.' : 'MSDS를 이 품목에서 뗐습니다.'); window.InventorySafetyUI?.refresh(); });
      }
      async function draw() {
        if (!alive()) return;
        const token = ++request, item = getItem(itemId), docs = item.msdsDocuments || [];
        element.replaceChildren();
        const heading = document.createElement('div'); heading.className = 'msds-heading';
        const title = document.createElement('h4'); title.textContent = `MSDS / SDS (물질안전보건자료) · ${docs.length}개`;
        const tools = document.createElement('div'); tools.className = 'msds-actions';
        const add = button('PDF 첨부', attach); add.id = 'msds-attach';
        const folder = button('문서 폴더', () => action(async () => { const r = await window.inventoryMSDS.folder(); if (!r?.ok) throw new Error(r?.error || '폴더 열기 실패'); })); folder.id = 'msds-folder';
        tools.append(add, folder); heading.append(title, tools); element.append(heading);
        const note = document.createElement('p'); note.className = 'hint msds-note';
        note.textContent = 'MSDS PDF를 첨부하면 프로그램 안에서 바로 열어볼 수 있습니다. 파일당 25 MB, 품목당 20개까지.'; element.append(note);
        if (!window.inventoryMSDS) { note.textContent = 'MSDS 첨부는 Windows 설치형 앱에서 사용할 수 있습니다.'; add.disabled = folder.disabled = true; return; }
        const list = document.createElement('div'); list.className = 'msds-list'; list.setAttribute('aria-live', 'polite'); element.append(list);
        if (!docs.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '첨부된 MSDS가 없습니다.'; list.append(empty); return; }
        list.textContent = '문서를 확인하는 중입니다…';
        try {
          const result = await window.inventoryMSDS.list(docs);
          if (!alive() || request !== token) return;
          if (!result?.ok) throw new Error(result?.error || '목록 조회 실패');
          list.replaceChildren();
          for (const doc of result.files) {
            const row = document.createElement('div'); row.className = 'msds-row'; row.dataset.document = doc.id;
            const info = document.createElement('div'); info.className = 'msds-info';
            const name = document.createElement('div'); name.className = 'msds-name'; name.textContent = doc.fileName;
            const meta = document.createElement('div'); meta.className = 'hint'; meta.textContent = `${formatSize(doc.size)} · 첨부 ${stamp(doc.addedAt)} · ${doc.available ? '저장됨' + (doc.file ? ' (' + doc.file + ')' : '') : '파일 없음 또는 손상'}`;
            if (!doc.available) { meta.classList.add('msds-error'); meta.title = doc.error || ''; }
            info.append(name, meta);
            const role=window.InventorySafetyCommon?.linkRole(getItem(itemId),doc);
            const badge=document.createElement('p');badge.className='hint';badge.dataset.msdsRole=role||'manual';
            badge.textContent=doc.koshaChemId?'받은 MSDS (KOSHA)'+(doc.koshaRevisedAt?' · 개정 '+doc.koshaRevisedAt:''):({reference:'같은 물질 참고 SDS (다른 제품)',product:'제품번호 일치 SDS',stale:'품목 정보 변경 후 재확인 필요',unverified:'제조사 문서',manual:'직접 첨부'})[role||'manual'];info.append(badge);
            const actions = document.createElement('div'); actions.className = 'msds-actions';
            const look = button('미리보기', () => preview(doc), 'primary'); look.dataset.msdsAction = 'preview';
            const view = button('외부 프로그램으로 열기', () => open(doc)); view.dataset.msdsAction = 'open';
            const copy = button('다른 이름으로 저장', () => exportDoc(doc)); copy.dataset.msdsAction = 'export';
            const remove = button('삭제', () => unlink(doc), 'danger'); remove.dataset.msdsAction = 'unlink';
            for (const b of [look, view, copy]) { b.dataset.unavailable = doc.available ? '0' : '1'; b.disabled = !doc.available; }
            if (doc.available && window.GHSUI?.isOldKosha?.(doc)) {
              badge.textContent += ' · 이전 방식으로 받음 (쪽이 잘려 보이면 새 서식으로 다시 받으세요)'; badge.classList.add('msds-old-note');
              const fresh = button('새 서식으로', () => action(async () => { await window.GHSUI.refetchKoshaDoc(getItem(itemId), doc, {getItem, getItems, save}); toast('MSDS를 새 서식으로 다시 받아 바꿨습니다.'); }));
              fresh.dataset.msdsAction = 'refresh'; fresh.title = '같은 물질의 MSDS를 새 서식으로 다시 받아 바꿉니다 (안전보건공단 KOSHA)'; actions.append(fresh);
            }
            if (!doc.available && doc.koshaChemId) {
              const again = button('다시 받기', () => action(async () => { await window.GHSUI.refetchKoshaDoc(getItem(itemId), doc, {getItem, getItems, save}); toast('MSDS를 다시 받아 교체했습니다.'); }), 'primary');
              again.dataset.msdsAction = 'refetch'; again.title = '같은 물질의 MSDS를 다시 받아 이 문서를 교체합니다 (안전보건공단 KOSHA)';
              actions.append(again, remove); row.append(info, actions); list.append(row); continue;
            }
            actions.append(look, view, copy, remove); row.append(info, actions); list.append(row);
          }
          if (busy) lock(true);
        } catch (e) { if (alive() && request === token) { list.textContent = '목록 확인 실패: ' + String(e.message || e); } }
      }
      draw();
      window.MSDSUI.current = {itemId, attach};
    }
  };
})();
