'use strict';
(() => {
  const MAX_DOCUMENTS = 20;
  const formatSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1024)) + ' KB';
  const stamp = s => { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', {hour12: false}) : ''; };
  window.MSDSUI = {
    mount({element, itemId, getItem, save, toast, confirm}) {
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
        if (busy || !confirm(`이 품목에서 아래 MSDS 연결을 해제할까요?\n\n${doc.fileName}\n\n다른 품목의 연결과 기존 백업은 바뀌지 않습니다.\n복원에 대비해 데이터 폴더의 PDF 파일은 남겨둡니다.`)) return;
        await action(async () => { const item = getItem(itemId); if (await commit((item.msdsDocuments || []).filter(d => d.id !== doc.id))) toast('MSDS 연결을 해제했습니다.'); });
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
            const remove = button('연결 해제', () => unlink(doc)); remove.dataset.msdsAction = 'unlink';
            for (const b of [look, view, copy]) { b.dataset.unavailable = doc.available ? '0' : '1'; b.disabled = !doc.available; }
            if (!doc.available && doc.koshaChemId) {
              const again = button('다시 받기', () => action(async () => { await window.GHSUI.refetchKoshaDoc(getItem(itemId), doc, {getItem, save}); toast('MSDS를 다시 받아 교체했습니다.'); }), 'primary');
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
