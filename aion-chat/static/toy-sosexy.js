(function (root, protocol, doc) {
  'use strict';
  if (!doc?.body?.classList.contains('toy-sosexy-page') || !protocol) return;

  const SERVICE_UUID = 0xee01;
  const WRITE_UUID = 0xee03;
  const NOTIFY_UUID = 0xee02;
  let presets = protocol.loadPresets(root.localStorage);
  let activePreset = -1;
  let connected = false;
  let connecting = false;
  let device = null;
  let server = null;
  let writeCharacteristic = null;
  let nativePending = null;

  const grid = doc.getElementById('sosexyPresetGrid');
  const stateLabel = doc.getElementById('toyConnectionState');
  const detailLabel = doc.getElementById('toyConnectionDetail');
  const connectButton = doc.getElementById('toyConnectButton');
  const stopButton = doc.getElementById('toyStopAllButton');
  const logElement = doc.getElementById('toyLog');
  const editor = doc.getElementById('sosexyEditor');
  const editorContent = doc.getElementById('sosexyEditorContent');

  function log(message, kind = 'system') {
    const line = doc.createElement('p');
    line.className = `toy-log-${kind}`;
    line.textContent = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${message}`;
    logElement.appendChild(line);
    while (logElement.children.length > 40) logElement.firstElementChild.remove();
    logElement.scrollTop = logElement.scrollHeight;
  }
  function usingNative() { return Boolean(root.AionBle && /AionChatApp/i.test(root.navigator?.userAgent || '')); }
  function nativeConnected() { try { return Boolean(root.AionBle?.isConnected()); } catch (error) { return false; } }
  function updateUI() {
    const ready = connected || nativeConnected();
    doc.body.classList.toggle('is-connected', ready);
    stateLabel.textContent = connecting ? '正在连接' : ready ? '已连接' : '未连接';
    detailLabel.textContent = ready ? (device?.name || 'SOSEXY · Android 原生') : '连接后即可使用九档预设';
    connectButton.textContent = ready ? '断开' : '连接';
    connectButton.disabled = connecting;
    stopButton.disabled = !ready;
    grid.querySelectorAll('.toy-preset-button').forEach((button, index) => {
      button.disabled = !ready;
      button.classList.toggle('is-active', index === activePreset);
    });
  }
  function renderGrid() {
    grid.innerHTML = '';
    protocol.PRESET_NAMES.forEach((name, index) => {
      const card = doc.createElement('div');
      card.className = 'toy-preset-card';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'toy-preset-button';
      button.innerHTML = `<span>${protocol.PRESET_ICONS[index]}</span><strong>${name}</strong><small>档位 ${index + 1}</small>`;
      button.addEventListener('click', () => activatePreset(index));
      const edit = doc.createElement('button');
      edit.type = 'button'; edit.className = 'toy-preset-edit'; edit.textContent = '编辑';
      edit.setAttribute('aria-label', `编辑${name}`);
      edit.addEventListener('click', () => openEditor(index));
      card.append(button, edit); grid.appendChild(card);
    });
    updateUI();
  }
  async function sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
  async function sendCommand(command) {
    log(`→ ${command}`, 'send');
    if (usingNative()) { root.AionBle.sendData(command); return; }
    if (!writeCharacteristic) throw new Error('玩具尚未连接');
    const packets = protocol.frameCommand(command);
    for (let index = 0; index < packets.length; index += 1) {
      if (writeCharacteristic.properties?.write && writeCharacteristic.writeValueWithResponse) await writeCharacteristic.writeValueWithResponse(packets[index]);
      else await writeCharacteristic.writeValueWithoutResponse(packets[index]);
      if (index < packets.length - 1) await sleep(30);
    }
  }
  async function activatePreset(index) {
    const preset = presets[index];
    if (!preset || !(connected || nativeConnected())) return;
    try {
      for (let motorIndex = 0; motorIndex < 3; motorIndex += 1) {
        const motor = preset.motors[motorIndex];
        const definition = protocol.MOTORS[motorIndex];
        await sendCommand(protocol.buildDualCmd(definition.modeSpec, motor.mode, definition.gearsSpec, motor.on ? motor.speed : 0));
        if (motorIndex < 2) await sleep(80);
      }
      activePreset = index; log(`运行 ${protocol.PRESET_NAMES[index]}`, 'success'); updateUI();
    } catch (error) { log(`写入失败：${error.message}`, 'error'); }
  }
  async function stopAll() {
    if (!(connected || nativeConnected())) return;
    activePreset = -1;
    try { await sendCommand(protocol.buildStopCmd()); log('全部停止', 'system'); }
    catch (error) { log(`停止失败：${error.message}`, 'error'); throw error; }
    finally { updateUI(); }
  }
  async function connectWeb() {
    if (!root.navigator?.bluetooth) throw new Error('当前浏览器不支持 Web Bluetooth，请使用电脑 Chrome');
    device = await root.navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'SOSEXY' }], optionalServices: [SERVICE_UUID] });
    device.addEventListener('gattserverdisconnected', () => {
      connected = false; writeCharacteristic = null; activePreset = -1; updateUI(); log('蓝牙连接已断开', 'error');
    });
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    writeCharacteristic = await service.getCharacteristic(WRITE_UUID);
    try { const notify = await service.getCharacteristic(NOTIFY_UUID); await notify.startNotifications(); } catch (error) {}
    connected = true;
  }
  async function connect() {
    if (connected || connecting || nativeConnected()) return;
    connecting = true; updateUI(); log('正在寻找 SOSEXY…');
    try {
      if (usingNative()) {
        root.AionBle.selectProfile?.('sosexy');
        await new Promise((resolve, reject) => { nativePending = { resolve, reject }; root.AionBle.connect(); });
      } else await connectWeb();
      log(`已连接 ${device?.name || 'SOSEXY'}`, 'success');
    } catch (error) { log(`连接失败：${error.message}`, 'error'); }
    finally { connecting = false; updateUI(); }
  }
  async function disconnect() {
    try { if (connected || nativeConnected()) await stopAll(); } catch (error) {}
    if (usingNative()) root.AionBle.disconnect();
    else if (device?.gatt?.connected) device.gatt.disconnect();
    connected = false; writeCharacteristic = null; activePreset = -1; updateUI(); log('已断开');
  }

  function openEditor(index) {
    const preset = presets[index];
    const blocks = preset.motors.map((motor, motorIndex) => {
      const definition = protocol.MOTORS[motorIndex];
      const choices = definition.modes.map((name, modeIndex) => `<option value="${modeIndex + 1}"${motor.mode === modeIndex + 1 ? ' selected' : ''}>${name}</option>`).join('');
      return `<fieldset class="toy-editor-motor"><legend>${definition.label}</legend><label class="toy-editor-toggle"><input type="checkbox" data-edit-on="${motorIndex}"${motor.on ? ' checked' : ''}> 启用</label><label>模式<select data-edit-mode="${motorIndex}">${choices}</select></label><label>速度 <output data-edit-output="${motorIndex}">${motor.speed}</output><input type="range" min="0" max="100" value="${motor.speed}" data-edit-speed="${motorIndex}"></label></fieldset>`;
    }).join('');
    editorContent.innerHTML = `<h2 id="sosexyEditorTitle">${protocol.PRESET_ICONS[index]} ${protocol.PRESET_NAMES[index]}</h2>${blocks}<div class="toy-sheet-actions"><button type="button" data-editor-cancel>取消</button><button type="button" data-editor-save>保存预设</button></div>`;
    editor.hidden = false;
    editorContent.querySelectorAll('[data-edit-speed]').forEach(input => input.addEventListener('input', () => { editorContent.querySelector(`[data-edit-output="${input.dataset.editSpeed}"]`).value = input.value; }));
    editorContent.querySelector('[data-editor-cancel]').addEventListener('click', closeEditor);
    editorContent.querySelector('[data-editor-save]').addEventListener('click', () => saveEditor(index));
  }
  function closeEditor() { editor.hidden = true; editorContent.innerHTML = ''; }
  function saveEditor(index) {
    presets[index].motors.forEach((motor, motorIndex) => {
      motor.on = editorContent.querySelector(`[data-edit-on="${motorIndex}"]`).checked ? 1 : 0;
      motor.mode = Number(editorContent.querySelector(`[data-edit-mode="${motorIndex}"]`).value);
      motor.speed = Number(editorContent.querySelector(`[data-edit-speed="${motorIndex}"]`).value);
    });
    protocol.savePresets(root.localStorage, presets); closeEditor(); log(`已保存 ${protocol.PRESET_NAMES[index]}`); renderGrid();
  }

  connectButton.addEventListener('click', () => (connected || nativeConnected()) ? disconnect() : connect());
  stopButton.addEventListener('click', () => stopAll().catch(() => {}));
  editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });
  root.toyNativeBle = {
    onConnected(profile, name) { connected = true; if (name) device = { name }; nativePending?.resolve(); nativePending = null; updateUI(); },
    onDisconnected() { connected = false; activePreset = -1; updateUI(); },
    onError(message) { nativePending?.reject(new Error(message)); nativePending = null; log(message, 'error'); },
    onLog(message) { log(message); },
  };
  root.stopAndDisconnectToy = disconnect;
  renderGrid();
})(window, window.SosexyProtocol, document);
