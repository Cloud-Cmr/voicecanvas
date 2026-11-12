/**
 * 内置音色模板库（原创设计，可直接使用）
 *
 * 命名原则：每个模板有一个诗意的中文名 + 一句意境说明，
 * 底层是一条真正能喂给 voicedesign 模型的高质量描述。
 *
 * 模板质量要求（照官方写作四维度）：
 * 性别年龄 / 音色质感 / 情绪语气 / 语速节奏，必要时加人设与场景。
 * 禁止后期处理词（混响/EQ/压缩），禁止矛盾特征。
 */

export interface BuiltinTemplate {
  id: string
  /** 诗意的中文名 */
  name: string
  /** 一句话意境，帮助用户理解这是什么声音 */
  tagline: string
  /** 分类 */
  category: '夜话' | '书中人' | '市井' | '异域' | '孩童' | '锋利' | '温柔' | '古老'
  /** 真正发给模型的音色描述 */
  prompt: string
  /** 配套的合成文本示例（让模板开箱就能试听） */
  sample: string
  /** 是否可用于唱歌（只有预置音色模式支持，这里是提醒） */
  tags?: string[]
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ===== 夜话 =====
  {
    id: 'xinghe-wenan',
    name: '星河问安',
    tagline: '深夜电台里那个让失眠的人安心的声音',
    category: '夜话',
    prompt:
      '二十八岁左右的女性，音色柔润低沉，带一点长夜未眠的沙哑。说话时气声很轻，句尾音微微下沉，像隔着一层薄窗帘对你说晚安。语速偏慢，句子之间留出长长的呼吸停顿，不催促任何人。',
    sample: '夜还长着呢，不用急着睡。我把灯调暗一点，你要是愿意，就听我随便说几句。',
    tags: ['治愈', '助眠'],
  },
  {
    id: 'yeban-diantai',
    name: '夜半频段',
    tagline: '老式收音机里传出的、有点失真的男声',
    category: '夜话',
    prompt:
      '四十岁上下的男性，声线厚实偏暖，中低音共鸣明显，说话带着老派广播员的从容。语速不快，字与字之间咬得清楚，句末习惯性轻微降调收住。情绪克制，像在讲一件与自己无关的旧事。',
    sample: '这里是午夜频段。今晚的天气，有小雨，风从北边来。接下来的几个小时，我陪你。',
    tags: ['电台', '怀旧'],
  },
  {
    id: 'mangmang',
    name: '茫茫白噪',
    tagline: '像雨声一样没有攻击性的中性嗓音',
    category: '夜话',
    prompt:
      '三十岁左右的中性嗓音，音色干净略带沙哑，情绪极平，几乎没有起伏。语速均匀缓慢，像在念一份不需要被记住的说明书。呼吸声自然可闻，不做修饰。',
    sample: '你可以不用听清我说什么。让我在这儿说着，你慢慢就困了。',
    tags: ['白噪', '助眠'],
  },

  // ===== 书中人 =====
  {
    id: 'zhongnian-shusheng',
    name: '灯下说书',
    tagline: '旧书页翻动时那种慢条斯理的讲述',
    category: '书中人',
    prompt:
      '六十岁上下的男性，北方口音的普通话，嗓音略沙哑带沧桑。语速缓慢沉稳，讲到要紧处会停顿半秒再继续，尾音微微下沉。情绪内敛，像一位饱经风霜的老先生在灯下给晚辈讲故事。',
    sample: '那年的雪下得早。人还没备好过冬的柴，天就先冷下来了。',
    tags: ['有声书', '叙事'],
  },
  {
    id: 'qingya',
    name: '青崖客',
    tagline: '武侠小说里那位不肯下山的隐者',
    category: '书中人',
    prompt:
      '五十多岁的男性，声线清瘦偏冷，气息绵长，说话像隔着雾气。语速极慢，每个字都咬得清楚但不费力。情绪淡，只有在提到某些旧事时，尾音会有一丝几不可闻的颤抖。',
    sample: '山上不问山下事。你要问，我便答；答完，你就下山吧。',
    tags: ['武侠', '冷调'],
  },
  {
    id: 'changan',
    name: '长安夜雨',
    tagline: '古风剧情里那个声音温柔却身负血仇的人',
    category: '书中人',
    prompt:
      '二十五六岁的男性，声线清亮温润，带着书卷气。语速中等偏慢，咬字轻巧，句末有轻微上扬再收住的习惯。情绪层次丰富——表面温和，底下压着克制的锋利，某些词会不自觉地加重。',
    sample: '今夜雨大，你且在我这里避一避。至于明日雨停，各走各的路便是。',
    tags: ['古风', '剧情'],
  },

  // ===== 市井 =====
  {
    id: 'zaoshi',
    name: '早市烟火',
    tagline: '街口那个嗓门亮堂、说话带笑的摊主',
    category: '市井',
    prompt:
      '四十岁上下的女性，嗓音明亮厚实，中气足，带北方口音。语速快，说话带着自然的笑意和招呼人的热情，句尾常上扬。音量偏大但绝不刺耳，像在人群中招呼熟客。',
    sample: '来来来，刚出锅的，还热着呢！您今儿来得巧，最后两份，给您留着。',
    tags: ['市井', '热闹'],
  },
  {
    id: 'chenshi',
    name: '晨市轻唤',
    tagline: '清晨集市上那种不吵不闹的招呼声',
    category: '市井',
    prompt:
      '三十五岁左右的男性，嗓音踏实温和，中等音量，带一点本地口音。语速适中，说话简省客气，句尾带一点询问感。情绪放松，不急着推销。',
    sample: '青菜是新到的，您看看合不合适。要多少我给您称。',
    tags: ['生活', '自然'],
  },

  // ===== 异域 =====
  {
    id: 'beifeng',
    name: '北风信使',
    tagline: '带着浓重口音、说话干脆利落的壮汉',
    category: '异域',
    prompt:
      'Heavy Russian accent, gruff middle-aged male, blunt and matter-of-fact. Speaks in short clipped sentences at a steady pace, voice low and chesty with audible breath at the start of each phrase. No warmth, no small talk.',
    sample: 'Yes. I took the box. It was heavy. Nobody stopped me.',
    tags: ['英文', '硬朗'],
  },
  {
    id: 'qiyu',
    name: '绮语轻吟',
    tagline: '耳朵贴得很近的轻声细语',
    category: '异域',
    prompt:
      'Young female, extreme close-up with a binaural, ear-to-ear ASMR feel. Audible breathing, subtle swallowing, and soft natural lip sounds. She speaks very slowly, creating a deeply relaxing and immersive experience, as if whispering directly beside your ear.',
    sample: 'Just breathe. In through your nose, out slowly. You are doing fine.',
    tags: ['ASMR', '英文'],
  },

  // ===== 孩童 =====
  {
    id: 'tongyan',
    name: '童言无忌',
    tagline: '六七岁孩子看什么都新鲜的那股劲儿',
    category: '孩童',
    prompt:
      '六七岁的女孩，嗓音清亮细嫩，带一点点奶音。语速偏快，句尾爱往上挑，说话时情绪起伏大，会突然兴奋也会突然认真。咬字不完全清晰，显得天真自然。',
    sample: '哇！你看那个云朵，像不像一只大兔子？我刚才看见它动了一下！',
    tags: ['童声', '活泼'],
  },
  {
    id: 'aixiao',
    name: '矮巷顽童',
    tagline: '巷子里那帮刚打完架、气喘吁吁的小子',
    category: '孩童',
    prompt:
      '八岁左右的男孩，声音清亮带鼻音，气息还没喘匀。语速快，句子短，带一点得意和不服气。咬字重，某些字会拖长。情绪外放，随时会笑出声。',
    sample: '不算不算！刚才那下我还没准备好呢，再来一次，这次我肯定赢你！',
    tags: ['童声', '顽皮'],
  },

  // ===== 锋利 =====
  {
    id: 'hanshuang',
    name: '寒霜判官',
    tagline: '一句话就能让会议室安静下来的那种声音',
    category: '锋利',
    prompt:
      '三十五岁上下的女性，声线偏冷，音色干净利落，中低音扎实。语速不快不慢，字字清晰，句末果断收住不留余地。情绪极度克制，音量不大却压得住场，偶尔在关键处略微加重。',
    sample: '这个方案，我不通过。原因有三条，请记下来。',
    tags: ['职场', '权威'],
  },
  {
    id: 'bojian',
    name: '薄剑出鞘',
    tagline: '冷笑话和真刀子只隔一个字的那种人',
    category: '锋利',
    prompt:
      '三十岁出头的男性，声线清薄锋利，气息收得很紧。语速中偏慢，咬字极清晰，句子之间停顿带着压迫感。情绪表面平淡，但重音落在词与词的缝隙里，让人心里发凉。',
    sample: '我不是在威胁你。我只是告诉你，接下来会发生什么。',
    tags: ['反派', '压迫'],
  },

  // ===== 温柔 =====
  {
    id: 'chunbo',
    name: '春波暖语',
    tagline: '哄你吃饭、催你睡觉的那种在乎',
    category: '温柔',
    prompt:
      '三十岁左右的女性，音色温暖圆润，带轻微的气声。语速偏慢，语气亲切自然，句尾常带一点上扬的笑意。情绪是克制的关心，不甜腻，像家人之间说话。',
    sample: '饭吃了没？别又说不饿。锅里给你留着，热一下就行。',
    tags: ['亲切', '关怀'],
  },
  {
    id: 'xishui',
    name: '溪水长流',
    tagline: '不紧不慢、能把人听静的叙述',
    category: '温柔',
    prompt:
      '四十岁左右的女性，音色柔和通透，几乎不带气声杂音。语速缓慢均匀，句子之间停顿自然，节奏平稳。情绪平和如水面，没有明显起伏，也不刻意温柔。',
    sample: '山里的溪水是不说话的。你坐在旁边久了，才听见它在说些什么。',
    tags: ['纪录片', '自然'],
  },

  // ===== 古老 =====
  {
    id: 'changzhe',
    name: '千年长者',
    tagline: '仿佛活过很多个时代的那种声音',
    category: '古老',
    prompt:
      '七十岁往上的男性，嗓音干涩沙哑，气息很短，说话时需要中途换气。语速极慢，每个字都像从很远的地方取来才放下。情绪淡到近乎空，偶尔一个词会突然带上极深的疲惫。',
    sample: '这些事，我也记不太清了。只记得那天的风很大，把门吹开了。',
    tags: ['沧桑', '叙事'],
  },
  {
    id: 'guqin',
    name: '古琴余韵',
    tagline: '像琴弦被拨动后留在空气里的那点震动',
    category: '古老',
    prompt:
      '五十岁上下的女性，声线清冷悠长，共鸣偏后，尾音有自然的延展。语速慢，句子有韵律感，停顿处留白很长。情绪空灵，像在念诵而不是说话。',
    sample: '月出东山之上，风过松林之间。此间无人，唯有回声。',
    tags: ['古风', '吟诵'],
  },
]

/** 按分类分组，供 UI 使用 */
export function groupTemplates(): Array<{ category: string; items: BuiltinTemplate[] }> {
  const order = ['夜话', '书中人', '市井', '温柔', '锋利', '孩童', '异域', '古老']
  const map = new Map<string, BuiltinTemplate[]>()
  for (const t of BUILTIN_TEMPLATES) {
    const list = map.get(t.category) || []
    list.push(t)
    map.set(t.category, list)
  }
  return order
    .filter((c) => map.has(c))
    .map((c) => ({ category: c, items: map.get(c)! }))
}
