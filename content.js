// ============================================================
//  Content Script — 页面内浮动面板 + 文本插入
//  面板直接注入页面 DOM，不存在 popup 焦点争抢问题
// ============================================================

(() => {
  // 防止重复注入
  if (document.getElementById('qp-panel-overlay')) return;

  // ========== 默认数据 ==========
  const DEFAULT_DATA = {
    groups: [
      { id: 'visual', name: '视觉相关' },
      { id: 'layout', name: '拼接相关' },
      { id: 'program', name: '程序相关' },
      { id: 'plan', name: '策划相关' },
      { id: 'motion', name: '动效相关' },
      { id: 'common', name: '通用' }
    ],
    phrases: [
      { id: '1', text: '@视觉 制作图标', groupId: 'visual' },
      { id: '2', text: '@视觉 制作banner', groupId: 'visual' },
      { id: '3', text: '@拼接 多语言超长缩小字号', groupId: 'layout' },
      { id: '4', text: '@拼接 多语言超长换行', groupId: 'layout' },
      { id: '5', text: '@拼接 多语言超长省略', groupId: 'layout' },
      { id: '6', text: '@程序 自适应跟随在后方', groupId: 'program' },
      { id: '7', text: '@程序 复用通用功能', groupId: 'program' },
      { id: '8', text: '@策划 需要配置', groupId: 'plan' },
      { id: '9', text: '@策划 需要确认文案', groupId: 'plan' },
      { id: '10', text: '@动效 需要制作动效', groupId: 'motion' },
    ],
    tagColors: {
      '@程序': '#3B82F6',
      '@拼接': '#8B5CF6',
      '@视觉': '#22C55E',
      '@策划': '#EF4444',
      '@动效': '#EC4899'
    }
  };

  let data = null;
  let panelVisible = false;
  let editingPhraseId = null;
  let editingGroupId = null;

  // ========== 光标追踪 ==========
  let savedRange = null;
  let savedInput = null;

  function trackSelection(e) {
    // 忽略面板内部的操作
    if (e.target.closest && e.target.closest('#qp-panel-overlay')) return;

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const editable = (container.nodeType === 1 ? container : container.parentElement)
        ?.closest('[contenteditable="true"]');
      if (editable) {
        savedRange = { range: range.cloneRange(), element: editable };
      }
    }

    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.closest('#qp-panel-overlay')) {
      savedInput = { element: el, start: el.selectionStart, end: el.selectionEnd };
    }
  }

  document.addEventListener('mouseup', trackSelection, true);
  document.addEventListener('keyup', trackSelection, true);
  document.addEventListener('focusin', trackSelection, true);

  // ========== 存储 ==========
  function loadData() {
    return new Promise(resolve => {
      chrome.storage.sync.get('quickPhrases', result => {
        data = result.quickPhrases || JSON.parse(JSON.stringify(DEFAULT_DATA));
        if (!data.tagColors) data.tagColors = { ...DEFAULT_DATA.tagColors };
        resolve();
      });
    });
  }

  function saveData() {
    return new Promise(resolve => {
      chrome.storage.sync.set({ quickPhrases: data }, resolve);
    });
  }

  // ========== Toast ==========
  function showToast(msg) {
    let toast = document.getElementById('qp-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'qp-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('qp-toast-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('qp-toast-show'), 1400);
  }

  // ========== HTML 工具 ==========
  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderTaggedText(text) {
    return esc(text).replace(/@(\S+)/g, (m, name) => {
      const key = '@' + name;
      const color = data.tagColors[key];
      return color
        ? `<span class="qp-tag" style="background:${color}">${esc(key)}</span>`
        : esc(m);
    });
  }

  // 给文档插入用的富文本 HTML
  function buildRichHTML(text) {
    let result = '';
    let last = 0;
    const re = /@(\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) result += esc(text.slice(last, m.index));
      const key = '@' + m[1];
      const color = data.tagColors[key];
      result += color
        ? `<span style="background-color:${color};color:#fff;padding:1px 4px;border-radius:3px;font-size:inherit">${esc(key)}</span>`
        : esc(m[0]);
      last = m.index + m[0].length;
    }
    if (last < text.length) result += esc(text.slice(last));
    return result;
  }

  // ========== 插入逻辑 ==========
  function insertPhrase(text) {
    const richHTML = buildRichHTML(text);
    const hasColor = richHTML !== esc(text);

    // 优先恢复 input/textarea
    if (savedInput) {
      const { element: el, start, end } = savedInput;
      if (document.contains(el)) {
        try {
          el.focus();
          el.selectionStart = start;
          el.selectionEnd = end;
          if (document.execCommand('insertText', false, text)) { showToast('✅ 已插入'); return; }
          el.value = el.value.slice(0, start) + text + el.value.slice(end);
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          showToast('✅ 已插入');
          return;
        } catch (e) { /* 继续 */ }
      }
    }

    // contenteditable 富文本
    if (savedRange) {
      const { range, element } = savedRange;
      if (document.contains(element)) {
        try {
          element.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);

          if (hasColor) {
            if (document.execCommand('insertHTML', false, richHTML)) {
              trackSelection({ target: element });
              showToast('✅ 已插入');
              return;
            }
            // fallback 手动插入
            range.deleteContents();
            const tmp = document.createElement('div');
            tmp.innerHTML = richHTML;
            const frag = document.createDocumentFragment();
            let lastNode;
            while (tmp.firstChild) { lastNode = tmp.firstChild; frag.appendChild(lastNode); }
            range.insertNode(frag);
            if (lastNode) { range.setStartAfter(lastNode); range.setEndAfter(lastNode); }
            sel.removeAllRanges();
            sel.addRange(range);
            element.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            if (document.execCommand('insertText', false, text)) {
              trackSelection({ target: element });
              showToast('✅ 已插入');
              return;
            }
            range.deleteContents();
            const tn = document.createTextNode(text);
            range.insertNode(tn);
            range.setStartAfter(tn);
            range.setEndAfter(tn);
            sel.removeAllRanges();
            sel.addRange(range);
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
          trackSelection({ target: element });
          showToast('✅ 已插入');
          return;
        } catch (e) { /* 继续 */ }
      }
    }

    // 全都不行 → 复制到剪贴板
    try {
      if (hasColor) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([richHTML], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
      } else {
        navigator.clipboard.writeText(text);
      }
    } catch (e) { /* ignore */ }
    showToast('📋 已复制，请 Ctrl+V');
  }

  // ========== 构建面板 DOM ==========
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'qp-panel-overlay';
    panel.innerHTML = `
      <div class="qp-header">
        <h2>⚡ 快捷短语</h2>
        <div class="qp-header-actions">
          <button class="qp-btn-icon" data-act="add-phrase" title="添加短语">＋</button>
          <button class="qp-btn-icon" data-act="add-group" title="添加分组">📁</button>
          <button class="qp-btn-icon" data-act="tag-colors" title="标签颜色">🎨</button>
          <button class="qp-btn-icon" data-act="settings" title="导入/导出">⚙</button>
          <button class="qp-btn-icon" data-act="close" title="关闭">✕</button>
        </div>
      </div>
      <div class="qp-search">
        <input type="text" id="qp-search" placeholder="搜索短语...">
      </div>
      <div class="qp-body" id="qp-body"></div>

      <!-- 短语弹窗 -->
      <div class="qp-modal-bg" id="qp-phrase-modal">
        <div class="qp-modal">
          <h3 id="qp-phrase-modal-title">添加短语</h3>
          <label>短语内容</label>
          <textarea id="qp-phrase-content" placeholder="例如：@视觉 制作图标"></textarea>
          <label>所属分组</label>
          <select id="qp-phrase-group"></select>
          <div class="qp-modal-actions">
            <button class="qp-btn qp-btn-danger" id="qp-del-phrase" style="margin-right:auto;display:none">删除</button>
            <button class="qp-btn qp-btn-cancel" data-dismiss="qp-phrase-modal">取消</button>
            <button class="qp-btn qp-btn-primary" id="qp-save-phrase">保存</button>
          </div>
        </div>
      </div>

      <!-- 分组弹窗 -->
      <div class="qp-modal-bg" id="qp-group-modal">
        <div class="qp-modal">
          <h3 id="qp-group-modal-title">添加分组</h3>
          <label>分组名称</label>
          <input type="text" id="qp-group-name" placeholder="例如：视觉相关">
          <div class="qp-modal-actions">
            <button class="qp-btn qp-btn-danger" id="qp-del-group" style="margin-right:auto;display:none">删除分组</button>
            <button class="qp-btn qp-btn-cancel" data-dismiss="qp-group-modal">取消</button>
            <button class="qp-btn qp-btn-primary" id="qp-save-group">保存</button>
          </div>
        </div>
      </div>

      <!-- 标签颜色弹窗 -->
      <div class="qp-modal-bg" id="qp-tag-modal">
        <div class="qp-modal">
          <h3>🎨 职能标签颜色</h3>
          <p style="font-size:11px;color:#999;margin-bottom:6px">短语中的 @职能 自动显示为彩色标签</p>
          <div id="qp-tag-list"></div>
          <div class="qp-add-tag-row">
            <input type="text" id="qp-new-tag" placeholder="如：@测试">
            <input type="color" id="qp-new-tag-color" value="#888888">
            <button class="qp-btn qp-btn-primary" id="qp-add-tag" style="padding:5px 8px;font-size:12px">添加</button>
          </div>
          <div class="qp-modal-actions">
            <button class="qp-btn qp-btn-cancel" data-dismiss="qp-tag-modal">关闭</button>
          </div>
        </div>
      </div>

      <!-- 设置弹窗 -->
      <div class="qp-modal-bg" id="qp-settings-modal">
        <div class="qp-modal">
          <h3>导入 / 导出</h3>
          <label>导出当前数据</label>
          <button class="qp-btn qp-btn-primary" id="qp-export" style="width:100%;margin-bottom:10px">📋 复制到剪贴板</button>
          <label>导入数据（JSON）</label>
          <textarea id="qp-import-data" placeholder="粘贴 JSON 数据..."></textarea>
          <div class="qp-modal-actions">
            <button class="qp-btn qp-btn-cancel" data-dismiss="qp-settings-modal">取消</button>
            <button class="qp-btn qp-btn-primary" id="qp-import">导入</button>
          </div>
        </div>
      </div>
    `;

    // 阻止面板内的 mousedown 冒泡影响页面选区
    // 但不阻止搜索框和模态框内的输入
    panel.addEventListener('mousedown', e => {
      // 允许面板内的 input/textarea/select 获取焦点
      const isFormEl = e.target.matches('input, textarea, select');
      if (!isFormEl) {
        e.preventDefault(); // 关键：阻止面板窃取页面焦点
      }
    });

    document.body.appendChild(panel);
    return panel;
  }

  // ========== 渲染列表 ==========
  function renderList(filter = '') {
    const body = document.getElementById('qp-body');
    if (!body) return;
    const lf = filter.toLowerCase();
    let html = '';

    for (const group of data.groups) {
      const phrases = data.phrases.filter(p =>
        p.groupId === group.id && (!lf || p.text.toLowerCase().includes(lf))
      );
      if (lf && !phrases.length) continue;

      html += `<div class="qp-group" data-gid="${group.id}">
        <div class="qp-group-header" data-gid="${group.id}">
          <div><span class="qp-group-toggle">▼</span>
          <span class="qp-group-title">${esc(group.name)}</span>
          <span style="color:#ccc;font-size:11px;margin-left:3px">(${phrases.length})</span></div>
          <div class="qp-group-actions">
            <button class="qp-btn-tiny" data-edit-group="${group.id}" title="编辑">✏️</button>
          </div>
        </div>
        <div class="qp-phrase-list">
          ${phrases.map(p => `<div class="qp-phrase-item" data-pid="${p.id}">
            <span class="qp-phrase-text">${renderTaggedText(p.text)}</span>
            <div class="qp-phrase-actions">
              <button class="qp-btn-tiny" data-edit-phrase="${p.id}" title="编辑">✏️</button>
            </div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    // 未分组
    const ungrouped = data.phrases.filter(p => !p.groupId && (!lf || p.text.toLowerCase().includes(lf)));
    if (ungrouped.length) {
      html += `<div class="qp-group"><div class="qp-group-header"><div>
        <span class="qp-group-toggle">▼</span><span class="qp-group-title">未分组</span>
        <span style="color:#ccc;font-size:11px;margin-left:3px">(${ungrouped.length})</span>
      </div></div><div class="qp-phrase-list">
        ${ungrouped.map(p => `<div class="qp-phrase-item" data-pid="${p.id}">
          <span class="qp-phrase-text">${renderTaggedText(p.text)}</span>
          <div class="qp-phrase-actions">
            <button class="qp-btn-tiny" data-edit-phrase="${p.id}" title="编辑">✏️</button>
          </div>
        </div>`).join('')}
      </div></div>`;
    }

    body.innerHTML = html || `<div class="qp-empty"><div class="qp-emoji">🔍</div><div>没有匹配的短语</div></div>`;
  }

  // ========== 分组选择器 ==========
  function fillGroupSelect(selectedId) {
    const sel = document.getElementById('qp-phrase-group');
    if (!sel) return;
    sel.innerHTML = '<option value="">未分组</option>';
    data.groups.forEach(g => {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.name;
      if (g.id === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  }

  // ========== 标签列表 ==========
  function renderTagConfig() {
    const list = document.getElementById('qp-tag-list');
    if (!list) return;
    let html = '';
    for (const [tag, color] of Object.entries(data.tagColors)) {
      html += `<div class="qp-tag-item" data-tag="${esc(tag)}">
        <span class="qp-tag-preview" style="background:${color}">${esc(tag)}</span>
        <input type="color" class="qp-tag-color-pick" value="${color}" data-tag="${esc(tag)}">
        <button class="qp-btn-tiny qp-del-tag" data-tag="${esc(tag)}" title="删除">✕</button>
      </div>`;
    }
    list.innerHTML = html || '<div style="color:#999;text-align:center;padding:10px">暂无标签</div>';
  }

  // ========== 面板显示/隐藏 ==========
  function togglePanel() {
    const panel = document.getElementById('qp-panel-overlay');
    if (!panel) return;
    panelVisible = !panelVisible;
    if (panelVisible) {
      panel.classList.add('qp-show');
      // 用 requestAnimationFrame 确保动画触发
      requestAnimationFrame(() => panel.classList.add('qp-show'));
      renderList();
    } else {
      panel.classList.remove('qp-show');
    }
  }

  function hidePanel() {
    panelVisible = false;
    document.getElementById('qp-panel-overlay')?.classList.remove('qp-show');
  }

  // ========== 事件绑定 ==========
  function bindEvents(panel) {
    const searchInput = document.getElementById('qp-search');

    // 搜索
    searchInput.addEventListener('input', () => renderList(searchInput.value));

    // 顶栏按钮
    panel.querySelector('.qp-header-actions').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close') hidePanel();
      else if (act === 'add-phrase') openPhraseModal(null);
      else if (act === 'add-group') openGroupModal(null);
      else if (act === 'tag-colors') { renderTagConfig(); showModal('qp-tag-modal'); }
      else if (act === 'settings') showModal('qp-settings-modal');
    });

    // 列表区点击
    panel.querySelector('.qp-body').addEventListener('click', e => {
      // 编辑短语
      const ep = e.target.closest('[data-edit-phrase]');
      if (ep) { e.stopPropagation(); openPhraseModal(ep.dataset.editPhrase); return; }

      // 编辑分组
      const eg = e.target.closest('[data-edit-group]');
      if (eg) { e.stopPropagation(); openGroupModal(eg.dataset.editGroup); return; }

      // 折叠分组
      const gh = e.target.closest('.qp-group-header');
      if (gh && !e.target.closest('.qp-group-actions')) {
        gh.closest('.qp-group')?.classList.toggle('collapsed');
        return;
      }

      // 点击短语 → 插入
      const item = e.target.closest('.qp-phrase-item');
      if (item) {
        const p = data.phrases.find(x => x.id === item.dataset.pid);
        if (p) insertPhrase(p.text);
      }
    });

    // 通用 dismiss
    panel.addEventListener('click', e => {
      const dismiss = e.target.closest('[data-dismiss]');
      if (dismiss) { hideModal(dismiss.dataset.dismiss); return; }
      // 点击模态背景关闭
      if (e.target.classList.contains('qp-modal-bg')) { e.target.classList.remove('qp-modal-show'); }
    });

    // ---- 短语弹窗 ----
    panel.querySelector('#qp-save-phrase').addEventListener('click', async () => {
      const text = document.getElementById('qp-phrase-content').value.trim();
      if (!text) return;
      const gid = document.getElementById('qp-phrase-group').value || null;
      if (editingPhraseId) {
        const p = data.phrases.find(x => x.id === editingPhraseId);
        if (p) { p.text = text; p.groupId = gid; }
      } else {
        data.phrases.push({ id: Date.now().toString(), text, groupId: gid });
      }
      await saveData();
      renderList(searchInput.value);
      hideModal('qp-phrase-modal');
      showToast('✅ 已保存');
    });

    panel.querySelector('#qp-del-phrase').addEventListener('click', async () => {
      if (!editingPhraseId) return;
      data.phrases = data.phrases.filter(p => p.id !== editingPhraseId);
      await saveData();
      renderList(searchInput.value);
      hideModal('qp-phrase-modal');
      showToast('🗑️ 已删除');
    });

    // ---- 分组弹窗 ----
    panel.querySelector('#qp-save-group').addEventListener('click', async () => {
      const name = document.getElementById('qp-group-name').value.trim();
      if (!name) return;
      if (editingGroupId) {
        const g = data.groups.find(x => x.id === editingGroupId);
        if (g) g.name = name;
      } else {
        data.groups.push({ id: Date.now().toString(), name });
      }
      await saveData();
      renderList(searchInput.value);
      hideModal('qp-group-modal');
      showToast('✅ 已保存');
    });

    panel.querySelector('#qp-del-group').addEventListener('click', async () => {
      if (!editingGroupId) return;
      data.phrases.forEach(p => { if (p.groupId === editingGroupId) p.groupId = null; });
      data.groups = data.groups.filter(g => g.id !== editingGroupId);
      await saveData();
      renderList(searchInput.value);
      hideModal('qp-group-modal');
      showToast('🗑️ 已删除');
    });

    // ---- 标签颜色 ----
    panel.querySelector('#qp-tag-list').addEventListener('input', async e => {
      if (e.target.classList.contains('qp-tag-color-pick')) {
        data.tagColors[e.target.dataset.tag] = e.target.value;
        await saveData();
        renderTagConfig();
        renderList(searchInput.value);
      }
    });

    panel.querySelector('#qp-tag-list').addEventListener('click', async e => {
      if (e.target.classList.contains('qp-del-tag')) {
        delete data.tagColors[e.target.dataset.tag];
        await saveData();
        renderTagConfig();
        renderList(searchInput.value);
        showToast('🗑️ 已删除');
      }
    });

    panel.querySelector('#qp-add-tag').addEventListener('click', async () => {
      let name = document.getElementById('qp-new-tag').value.trim();
      const color = document.getElementById('qp-new-tag-color').value;
      if (!name) return;
      if (!name.startsWith('@')) name = '@' + name;
      data.tagColors[name] = color;
      await saveData();
      document.getElementById('qp-new-tag').value = '';
      renderTagConfig();
      renderList(searchInput.value);
      showToast('✅ 已添加');
    });

    // ---- 导入导出 ----
    panel.querySelector('#qp-export').addEventListener('click', async () => {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      showToast('📋 已复制');
    });

    panel.querySelector('#qp-import').addEventListener('click', async () => {
      const raw = document.getElementById('qp-import-data').value.trim();
      if (!raw) return;
      try {
        const obj = JSON.parse(raw);
        if (obj.groups && obj.phrases) {
          if (!obj.tagColors) obj.tagColors = {};
          data = obj;
          await saveData();
          renderList();
          hideModal('qp-settings-modal');
          showToast('✅ 导入成功');
        } else { showToast('❌ 格式错误'); }
      } catch { showToast('❌ JSON 解析失败'); }
    });
  }

  // ========== 弹窗辅助 ==========
  function showModal(id) { document.getElementById(id)?.classList.add('qp-modal-show'); }
  function hideModal(id) { document.getElementById(id)?.classList.remove('qp-modal-show'); }

  function openPhraseModal(phraseId) {
    editingPhraseId = phraseId;
    const title = document.getElementById('qp-phrase-modal-title');
    const content = document.getElementById('qp-phrase-content');
    const delBtn = document.getElementById('qp-del-phrase');
    if (phraseId) {
      const p = data.phrases.find(x => x.id === phraseId);
      title.textContent = '编辑短语';
      content.value = p?.text || '';
      fillGroupSelect(p?.groupId);
      delBtn.style.display = 'inline-block';
    } else {
      title.textContent = '添加短语';
      content.value = '';
      fillGroupSelect('');
      delBtn.style.display = 'none';
    }
    showModal('qp-phrase-modal');
  }

  function openGroupModal(groupId) {
    editingGroupId = groupId;
    const title = document.getElementById('qp-group-modal-title');
    const nameInput = document.getElementById('qp-group-name');
    const delBtn = document.getElementById('qp-del-group');
    if (groupId) {
      const g = data.groups.find(x => x.id === groupId);
      title.textContent = '编辑分组';
      nameInput.value = g?.name || '';
      delBtn.style.display = 'inline-block';
    } else {
      title.textContent = '添加分组';
      nameInput.value = '';
      delBtn.style.display = 'none';
    }
    showModal('qp-group-modal');
  }

  // ========== 消息监听 ==========
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PANEL') togglePanel();
  });

  // ========== 初始化 ==========
  loadData().then(() => {
    const panel = buildPanel();
    bindEvents(panel);
  });

})();
