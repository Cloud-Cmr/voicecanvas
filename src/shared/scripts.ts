/**
 * 场景文案模板库
 *
 * 与「声音模板」互补：声音模板解决"用什么声音"，文案模板解决"说什么"。
 * 每条给的是一段可以直接拿去生成的示例文本，带风格标签。
 */

export interface ScriptTemplate {
  id: string
  name: string
  /** 所属场景 */
  scene: '广告' | '有声书' | '播客' | '短视频' | '通知' | '游戏' | '教育' | '情感'
  /** 一句话用途说明 */
  usage: string
  /** 可直接使用的文案（含风格标签） */
  text: string
  /** 建议搭配的声音风格 */
  voiceHint: string
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  // ===== 广告 =====
  {
    id: 'ad-energetic',
    name: '新品发布·热血版',
    scene: '广告',
    usage: '新品上市的短促有力口播',
    text: '(兴奋 语速加快)全新一代来了！更强性能，更轻机身，续航提升百分之四十。这一次，不用再妥协。现在就下单，首发立减三百！',
    voiceHint: '明亮有活力的青年声，语速快',
  },
  {
    id: 'ad-warm',
    name: '品牌温度·走心版',
    scene: '广告',
    usage: '需要情感共鸣的品牌短片',
    text: '(温柔)有些陪伴，从来不说出口。它在清晨的一杯热水里，在深夜留的一盏灯里。二十年了，我们只做一件事——把日子过得像家。',
    voiceHint: '温暖厚实的中年声，语速慢',
  },
  {
    id: 'ad-premium',
    name: '高端质感·克制版',
    scene: '广告',
    usage: '奢侈品/高端产品，靠留白和停顿',
    text: '(深沉 语速极慢)时间，从不辜负认真的人。[停顿]每一道纹路，都是数十次打磨的结果。它不喧哗。它只是，在那里。',
    voiceHint: '低沉磁性的男声，气声足',
  },

  // ===== 有声书 =====
  {
    id: 'book-narrative',
    name: '小说叙事·第三人称',
    scene: '有声书',
    usage: '小说正文的常规叙述段落',
    text: '那年的雪下得格外早。人还没备好过冬的柴，天就先冷了下来。[停顿]他站在门口，看着院子里那棵老槐树，忽然觉得有什么东西，再也回不去了。',
    voiceHint: '沉稳的叙事男声或女声，节奏平稳',
  },
  {
    id: 'book-dialogue',
    name: '对话·双角色切换',
    scene: '有声书',
    usage: '一段对白，靠语气区分角色',
    text: '(低沉 压着怒意)你到底想说什么？[停顿](轻笑 轻蔑)我没什么想说的。我只是想看看，你还能撑多久。',
    voiceHint: '能演出情绪落差的声线',
  },
  {
    id: 'book-suspense',
    name: '悬疑·压抑逼近',
    scene: '有声书',
    usage: '恐怖/悬疑的紧张段落',
    text: '(压低声线 气声)走廊尽头的灯，又灭了。[停顿]他数着自己的心跳，一步，两步……(颤抖)门把手，动了。',
    voiceHint: '低音、气声重、有明显停顿',
  },

  // ===== 播客 =====
  {
    id: 'podcast-intro',
    name: '播客开场白',
    scene: '播客',
    usage: '每期固定的节目开场',
    text: '(轻松 带笑)欢迎回到《慢慢说》。今天我们不聊大道理，就聊聊那些说出来有点矫情、但憋在心里又难受的小事。泡杯茶，我们开始吧。',
    voiceHint: '亲切自然的主播声',
  },
  {
    id: 'podcast-transition',
    name: '段落过渡',
    scene: '播客',
    usage: '话题切换时的自然衔接',
    text: '(放缓 略沉吟)说到这儿，我想起另一件事。[停顿]这件事跟刚才那个看似没关系，但其实是同一个问题的两面。',
    voiceHint: '语速中等，有思考感',
  },

  // ===== 短视频 =====
  {
    id: 'short-hook',
    name: '三秒钩子',
    scene: '短视频',
    usage: '开头抓住注意力的强钩子',
    text: '(语速极快 上扬)别再这样充电了！你手机电池就是这么被充坏的，九十秒讲清楚，看完记得存下来。',
    voiceHint: '高能量、语速快、咬字清',
  },
  {
    id: 'short-explainer',
    name: '知识科普',
    scene: '短视频',
    usage: '中等语速的讲解',
    text: '(平静 清晰)为什么冰块放进热水，裂开的声音不一样？[停顿]答案藏在热胀冷缩的细节里。我们分三步看。',
    voiceHint: '清晰平稳的讲解声',
  },

  // ===== 通知 =====
  {
    id: 'notice-station',
    name: '车站/机场广播',
    scene: '通知',
    usage: '公共场所播报',
    text: '(标准 平稳)各位旅客请注意，开往上海虹桥方向的G7126次列车，现在开始检票。请携带好随身物品，从三号检票口有序进站。',
    voiceHint: '标准播音腔，音量适中',
  },
  {
    id: 'notice-app',
    name: 'App 语音提示',
    scene: '通知',
    usage: '产品内的语音反馈',
    text: '(轻快 简短)已为你规划好路线，全程十二公里，预计需要二十五分钟。祝你一路顺利。',
    voiceHint: '清晰友好的中性声',
  },

  // ===== 游戏 =====
  {
    id: 'game-npc',
    name: 'NPC 任务引导',
    scene: '游戏',
    usage: '游戏内的任务对话',
    text: '(苍老 缓慢)年轻人，你终于来了。[停顿]北边的森林最近不太平，村民们已经三天不敢出门。若你愿意去看看，我这儿有些东西，或许用得上。',
    voiceHint: '沧桑长者声',
  },
  {
    id: 'game-boss',
    name: 'Boss 登场台词',
    scene: '游戏',
    usage: '强力敌人的登场宣言',
    text: '(低沉 压迫 回声感)你走到了这里，很好。[停顿]可惜，到此为止了。(冷笑)让我看看，你能撑过几个回合。',
    voiceHint: '低音、有威压感',
  },

  // ===== 教育 =====
  {
    id: 'edu-lesson',
    name: '课程讲解',
    scene: '教育',
    usage: '知识点讲解的语速示范',
    text: '(清晰 适中)我们先看第一个概念。[停顿]这里容易混淆的地方在于，它和表面看起来的意思，恰恰相反。给大家举个例子。',
    voiceHint: '清晰、有条理、语速中',
  },
  {
    id: 'edu-encourage',
    name: '学习鼓励',
    scene: '教育',
    usage: '给学生的正向反馈',
    text: '(温和 带笑)这道题你自己做出来了，很棒。[停顿]注意看你第二步的思路，那个转折点，就是你真正理解的地方。',
    voiceHint: '温暖鼓励的语气',
  },

  // ===== 情感 =====
  {
    id: 'emo-night',
    name: '晚安电台',
    scene: '情感',
    usage: '睡前陪伴类内容',
    text: '(极温柔 语速极慢)今天的你，辛苦了。[停顿]不用急着总结今天做得够不够好。此刻你只需要，把手机放下，闭上眼睛。明天的事，留给明天的你。',
    voiceHint: '低柔、气声、语速极慢',
  },
  {
    id: 'emo-letter',
    name: '书信独白',
    scene: '情感',
    usage: '第一人称的信件朗读',
    text: '(平静 略克制)见字如面。[停顿]写信这件事，我搁置了很久。不是没话说，是话太多，反而不知道从哪句开始。那就，从一句谢谢开始吧。',
    voiceHint: '内敛克制、有呼吸感',
  },
]

export function groupScripts(): Array<{ scene: string; items: ScriptTemplate[] }> {
  const order = ['广告', '有声书', '播客', '短视频', '通知', '游戏', '教育', '情感']
  const map = new Map<string, ScriptTemplate[]>()
  for (const s of SCRIPT_TEMPLATES) {
    const list = map.get(s.scene) || []
    list.push(s)
    map.set(s.scene, list)
  }
  return order.filter((s) => map.has(s)).map((s) => ({ scene: s, items: map.get(s)! }))
}
