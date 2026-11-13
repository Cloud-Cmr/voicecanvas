// 加分组标题样式
const fs = require('fs')
const f = 'src/renderer/src/App.vue'
let c = fs.readFileSync(f, 'utf8')
const css = `
.nav-group-title {
  font-size: 10px;
  color: var(--vc-text-faint);
  letter-spacing: 0.14em;
  padding: 12px 10px 4px;
  user-select: none;
}
`
c = c.replace('</style>', css + '</style>')
fs.writeFileSync(f, c)
console.log('样式已加')
