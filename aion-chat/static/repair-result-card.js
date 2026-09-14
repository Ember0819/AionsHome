/* Optional group-chat renderer. No repair triggers or model prompts. */
window.RepairResultCard = {
  render(attachments, content) {
    const card = Array.isArray(attachments) && attachments.find(item => item?.type === 'repair_result');
    if (!card || !/^[a-f0-9]{32}$/.test(card.task_id || '')) return '';
    const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const lines=String(content||'').split('\n');
    const summary=card.summary || lines.slice(2).filter(line=>!line.startsWith('[查看维修记录]')).join('\n');
    return `<a class="repair-result-card" href="/repair?task=${card.task_id}"><strong>${escape(lines[0] || '🛠️ 维修室成果')}</strong><span class="repair-result-summary">${escape(summary)}</span><small>已验收 · 查看维修记录 →</small></a>`;
  }
};
