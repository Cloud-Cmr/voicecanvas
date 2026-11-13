// App.vue 需要多处配合 navGroups 的调整：
// 1. current computed 从平铺列表找
// 2. 快捷键 label
// 3. template 双层循环 + 分组标题
const fs = require('fs')
const f = 'src/renderer/src/App.vue'
let c = fs.readFileSync(f, 'utf8')

// 加一个平铺 computed（供 current/快捷键用）
if (!c.includes('flatItems')) {
  c = c.replace(
    'const current = computed(() => navItems.find((n) => n.key === active.value)!)',
    'const flatItems = computed(() => navGroups.flatMap((g) => g.items))\nconst current = computed(() => flatItems.value.find((n) => n.key === active.value)!)',
  )
}
// 快捷键 label 引用
c = c.replace('label: `切到${navItems.find((n) => n.key === k)?.label}`,', 'label: `切到${flatItems.value.find((n) => n.key === k)?.label}`,')
// 快捷键列表来源（tabOrder 仍可用，但需用 flatItems 找 label —— 已改）
// template：双层循环 + 分组标题
c = c.replace(
  /<nav class="nav">\s*<button\s*v-for="item in navItems"/,
  '<nav class="nav">\n      <template v-for="g in navGroups" :key="g.title || \'core\'">\n        <div v-if="g.title" class="nav-group-title">{{ g.title }}</div>\n        <button\n          v-for="item in g.items"\n          :key="item.key"\n          class="nav-item"\n          :class="{ active: active === item.key }"\n          @click="go(item.key)"\n        >',
)
// 每个 item 的闭合后要闭合 template —— 找原闭合点改写
c = c.replace(
  /(\s*<\/button>\s*)<\/nav>/,
  '$1\n      </template>\n    </nav>',
)
// nav-item 的 :key=item.key 会在双层里重复 —— 没问题 key 仍唯一
fs.writeFileSync(f, c)
console.log('App.vue 已适配 navGroups')
// 验证
console.log('flatItems:', c.includes('flatItems'))
console.log('双层循环:', c.includes('v-for="g in navGroups"'))
console.log('分组标题:', c.includes('nav-group-title'))
