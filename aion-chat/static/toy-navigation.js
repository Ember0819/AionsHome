(function (root) {
  'use strict';

  const STORAGE_KEY = 'aion_toy_last_profile';
  const DESTINATIONS = Object.freeze({
    sosexy: '/toys/sosexy',
    svakom: '/toys/svakom',
  });

  function destination(profile) {
    return DESTINATIONS[profile] || '/toys';
  }

  function remember(profile) {
    if (!DESTINATIONS[profile]) return;
    try { root.localStorage.setItem(STORAGE_KEY, profile); }
    catch (error) { root.console?.warn?.(`无法记住玩具选择: ${error.message}`); }
  }

  function navigate(profile) {
    if (DESTINATIONS[profile]) remember(profile);
    try {
      if (root.parent && root.parent !== root && typeof root.parent.openSubPage === 'function') {
        root.parent.openSubPage(destination(profile));
        return;
      }
    } catch (error) { root.console?.warn?.(`无法使用小家导航: ${error.message}`); }
    root.location.href = destination(profile);
  }

  async function switchTo(profile) {
    try {
      if (typeof root.stopAndDisconnectToy === 'function') {
        await root.stopAndDisconnectToy();
      }
    } catch (error) {
      root.console?.warn?.(`切换前停止失败: ${error?.message || error}`);
    } finally {
      navigate(profile);
    }
  }

  function returnToChat() {
    try {
      if (root.parent && root.parent !== root && typeof root.parent.returnFromToyControls === 'function') {
        root.parent.returnFromToyControls();
        return;
      }
    } catch (error) { root.console?.warn?.(`无法返回聊天: ${error.message}`); }
    navigate('');
  }

  function bindPage() {
    document.querySelectorAll('[data-toy-profile]').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.toyProfile));
    });
    document.querySelectorAll('[data-switch-profile]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await switchTo(button.dataset.switchProfile); }
        finally { button.disabled = false; }
      });
    });
    document.querySelectorAll('[data-toy-return]').forEach(link => {
      link.addEventListener('click', event => { event.preventDefault(); returnToChat(); });
    });
  }

  root.ToyNavigation = Object.freeze({
    key: STORAGE_KEY,
    open: navigate,
    switchTo,
    destination,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPage, { once: true });
  } else {
    bindPage();
  }
})(window);
