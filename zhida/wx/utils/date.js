function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateLabel(date) {
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${m}-${d} 周${week[date.getDay()]}`;
}

function greetingByHour(hour) {
  if (hour < 5) return '夜深';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

module.exports = {
  formatDateLabel,
  greetingByHour
};
