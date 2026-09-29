import { demoBookById } from "./catalog";
import { makeCatalogNovel, makeCatalogGraph } from "./catalog/runtime";
import type { DemoScenario } from "./catalog/types";
import { normalizeWorkspaceState } from "@/lib/workspace-state";
import { createDefaultAISettings } from "@/lib/ai-settings";
import { createDefaultPresetCompatLibrary } from "@/lib/preset-compat/surface-contract";
import { countChineseFriendlyWords, plainTextToHtml } from "@/lib/utils";
import type { Chapter, Character, OutlineItem, WorldEntry } from "@/lib/types";
import type { GraphAwareResult } from "@/lib/server/graph-types";
import type { WritingSkillCardDetail } from "@/lib/writing-skill-types";

export const seedDate = "2026-09-27T08:00:00.000Z";
export const sourceText = "他本该转身离开，却看见她手里也握着另一把钥匙。";
export const generatedText =
  "林舟没有松开钥匙，只向她走近了一步。\n\n“带路。”\n\n沈遥侧过身，让出剧院门口的位置。雨水在她的伞沿汇成一线，像是终于找到了可以落下的地方。她没有问他为什么改变主意，只把另一把钥匙放进他的掌心。\n\n门后传来旧挂钟缓慢的滴答声。林舟认得那个声音。十年前，哥哥最后一次带他来这里时，那口钟就已经停了。\n\n“别急着问。”沈遥说，“先把灯打开。”";
export const futureText =
  "灯塔顶层的窗户开着，海风把那封信吹得轻轻作响。\n\n林舟将两把铜钥匙并排放在窗台上。潮水退去，北岸渡口的灯一盏接一盏亮起。他终于明白，哥哥留下的不是一条逃离的路，而是一条回来的路。\n\n沈遥站在楼梯口，没有催他。\n\n“这次一起走。”他说。\n\n她笑了，把那张一直没用过的船票递给他。";
const texts = [
  "雾从海面推上来，渡口的钟刚敲过六下。林舟在最后一班渡船离岸前赶到，手里攥着一封没有署名的信。\n\n信上没有地址，只有一句话：退潮时，到旧剧院来。信封里滑出一把铜钥匙，齿口磨得很平。\n\n何叔抬头看了看他，又看了看钥匙。“北岸的雾一起来，路就不是昨天那条路了。”\n\n林舟想追问，却看见一个撑伞的姑娘从栏杆旁走过。她从口袋里取出一张折好的船票，压在栏杆下，像把一句话留给不会回头的人。\n\n船票背面写着两个字：沈遥。",
  "旧剧院在街道尽头，红色招牌褪成了灰。林舟推开外门，灰尘落在鞋尖上，舞台正中放着一把椅子。\n\n椅背上搭着哥哥的旧外套。十年前他离开时，就是穿着这件衣服。林舟伸手摸了摸口袋，里面只有半张节目单。\n\n他沿着节目单的折痕看下去，发现有人用铅笔画出一座灯塔。纸张背面写着：钥匙不止一把。\n\n门外有人收起伞。林舟回头，看见昨天渡口那个姑娘。\n\n“你找到第一把了。”她说。",
  "雨水顺着屋檐落下来，像一串没有说完的话。林舟把钥匙攥在手心，金属的凉意让他想起那封没有署名的信。\n\n“你还是来了。”沈遥站在剧院门口，伞面遮住了她的眼睛。\n\n" +
    sourceText +
    "远处的钟敲了十一下，雨幕里，剧院的门缓缓向内打开。\n\n“进去吧。”她说，“有些答案，只能在故事里找。”\n\n林舟停在门槛上。台阶的积水映着一盏摇晃的灯，灯光后面是一条窄长的走廊。墙上的演出海报被潮气卷起了边角，露出一行更旧的字。\n\n沈遥没有替他作决定。她只是站在那里，握着那把和他一模一样的钥匙。",
  "灯塔的来信比潮水晚了一天。何叔把它夹在渡口的值班簿里，等林舟独自来取。\n\n“你哥哥也总是问这个问题。”老人说，“为什么所有船都在涨潮时走，只有那艘船等退潮。”\n\n林舟翻开信纸。纸上画着三条路线，一条穿过剧院，一条经过北岸，最后一条停在灯塔地下室。三条线的尽头，都画着两把钥匙。\n\n沈遥在门外等他。她看了一眼信，低声说：“下一次退潮是明晚，我们还有时间。”",
  "北岸的雾比预想中来得早。道路尽头的路灯一盏盏熄灭，潮水漫过低矮的石阶。\n\n沈遥抓住林舟的袖口，把他带进一条背风的小巷。巷子里挂着旧航海图，上面的日期和哥哥失踪那天相同。\n\n“你早就知道。”林舟说。\n\n她点了点头，却没有松手。“我知道他留下了什么。我不知道你愿不愿意去看。”\n\n林舟看着雾里的灯塔。它的光在这一刻转向了他们。",
  "没有署名的人终于留下了名字。剧院后台的柜子里，整整齐齐放着十年前的值班记录，最后一页是哥哥的笔迹。\n\n他曾帮助北岸的人在风暴前转移。那艘等待退潮的船不是逃跑用的，而是回去接最后一批乘客。\n\n沈遥就是其中一个。\n\n“我答应过他，把钥匙交给你。”她说，“但我一直不知道怎么开口。”\n\n林舟将记录合上，轻轻推回原处。“现在我们一起去。”",
  "潮汐之后，所有被遮住的路都显露出来。通往灯塔的石堤浮出水面，海藻沿着石缝缓慢舒展。\n\n何叔在渡口点亮最后一盏灯。他没有再阻拦，只递来一件雨衣。\n\n林舟和沈遥并肩走上石堤。远处的灯塔不再转动，光束停在地下室入口。\n\n两把钥匙同时转动，门开了。里面没有想象中的秘密装置，只有一个保存得很好的木箱，和一封写给十年后家人的信。",
  futureText,
];
const titles = [
  "渡口",
  "旧剧院",
  "雨夜的铜钥匙",
  "灯塔来信",
  "北岸的雾",
  "没有署名的人",
  "潮汐之后",
  "灯塔重逢",
];

export function makeNovel(id: string, title: string) {
  if (demoBookById[id]) return makeCatalogNovel(demoBookById[id]);
  const isSpace = id === "demo-star";
  const chapters: Chapter[] = texts.map((text, i) => {
    const prose = isSpace
      ? text
          .replaceAll("林舟", "许澄")
          .replaceAll("沈遥", "叶星")
          .replaceAll("灯塔", "信标站")
          .replaceAll("渡口", "空间港")
          .replaceAll("铜钥匙", "航行密钥")
          .replaceAll("剧院", "观测站")
          .replaceAll("何叔", "老船长")
      : text;
    return {
      id: `${id}-ch-${i + 1}`,
      novelId: id,
      title: `第 ${i + 1} 章 ${isSpace ? ["归航", "观测站", "双重密钥", "信标来信", "星云边缘", "无名航线", "风暴之后", "星海重逢"][i] : titles[i]}`,
      order: i + 1,
      content: plainTextToHtml(prose),
      originalContent: plainTextToHtml(prose),
      wordCount: countChineseFriendlyWords(prose),
      status: "done",
      updatedAt: seedDate,
    };
  });
  const names = isSpace ? ["许澄", "叶星", "老船长"] : ["林舟", "沈遥", "何叔"];
  const characters: Character[] = names.map((name, i) => ({
    id: `${id}-person-${i}`,
    novelId: id,
    name,
    aliases: [],
    role: ["主角", "信使", "守望者"][i],
    goal: ["找到哥哥失踪的真相", "完成十年前的约定", "保护最后一条航线"][i],
    trait: ["克制、敏锐", "冷静、坚定", "寡言、固执"][i],
    note: [
      "习惯将疑问留在心里，直到线索逼他作出选择。",
      "持有另一把钥匙，知道信件的来历。",
      "见证了十年前的事件。",
    ][i],
    importanceTier: i === 0 ? "protagonist" : "important",
    classificationKey: i === 0 ? "tier0" : "tier1",
    profile: {
      personality: {
        content: [
          "外表冷静，面对家人线索时会失去耐心。",
          "不轻易许诺，但会坚持完成约定。",
          "重视规则，也懂得为重要的人破例。",
        ][i],
      },
      identity: { content: ["调查者", "信使", "渡口管理员"][i] },
      appearance: { content: "深色外衣，袖口留着雨水的痕迹。" },
    },
  }));
  const outlines: OutlineItem[] = [
    {
      id: `${id}-outline`,
      novelId: id,
      title: "两把钥匙",
      type: "foreshadow",
      summary: "信封里的钥匙与信使手中的钥匙，共同指向最终的答案。",
      relatedChapterIds: chapters.map((c) => c.id),
    },
  ];
  const world: WorldEntry[] = [
    {
      id: `${id}-place`,
      novelId: id,
      title: isSpace ? "观测站" : "旧剧院",
      type: "location",
      content: "曾经熙攘，如今无人问津；内部藏着一条通往海边的暗道。",
    },
    {
      id: `${id}-item`,
      novelId: id,
      title: isSpace ? "航行密钥" : "铜钥匙",
      type: "item",
      content: "两把必须同时使用的钥匙。",
    },
    {
      id: `${id}-group`,
      novelId: id,
      title: "北岸守望会",
      type: "organization",
      content: "守护航线和旧约的民间组织。",
    },
  ];
  return normalizeWorkspaceState({
    currentNovelId: id,
    currentChapterId: chapters[0].id,
    localNovels: [
      {
        id,
        title,
        summary: "一封没有署名的信，两把钥匙，一次迟到十年的重逢。",
        tags: ["原创虚构", "演示数据"],
      },
    ],
    localChapters: chapters,
    localCharacters: characters,
    localOutlines: outlines,
    localWorldEntries: world,
    localCharacterRelations: [
      {
        id: `${id}-relation`,
        novelId: id,
        fromCharacterId: characters[0].id,
        toCharacterId: characters[1].id,
        label: "同盟",
        strength: "strong",
        status: "active",
        chapterIds: [chapters[2].id],
        note: "从相互试探到共同赴约。",
      },
    ],
    localTimelineEvents: [
      {
        id: `${id}-event`,
        novelId: id,
        title: "两把钥匙相遇",
        phase: "转折",
        worldline: "主线",
        summary: "剧院门前，信使亮出另一把钥匙。",
        order: 3,
        chapterIds: [chapters[2].id],
      },
    ],
  });
}

export function makeSettings() {
  const settings = createDefaultAISettings();
  for (const scenario of Object.values(settings)) {
    scenario.provider = "openai-compatible";
    Object.assign(scenario.openAICompatible, {
      baseUrl: "https://demo.invalid/v1",
      model: "ReTale Dummy Model",
      apiKey: "",
      apiKeyConfigured: true,
      apiKeyMasked: "demo",
      configured: true,
    });
  }
  return settings;
}

export function makeGraph(
  novel: ReturnType<typeof makeNovel>,
): GraphAwareResult {
  if (demoBookById[novel.currentNovelId]) return makeCatalogGraph(novel);
  const nodes = [
    ...novel.localCharacters.map((c, i) => ({
      id: c.id,
      label: c.name,
      entityType: "character" as const,
      description: c.note,
      importance: 1 - i * 0.2,
      confidence: 0.98,
      userConfirmed: true,
      firstSeenChapter: 1,
      lastSeenChapter: 8,
      score: 1,
    })),
    ...novel.localWorldEntries
      .slice(0, 2)
      .map((w) => ({
        id: w.id,
        label: w.title,
        entityType:
          w.type === "location" ? ("location" as const) : ("item" as const),
        description: w.content,
        importance: 0.6,
        confidence: 0.92,
        userConfirmed: true,
        score: 0.9,
      })),
  ];
  const pairs = [
    [0, 1, "同盟"],
    [0, 2, "求助"],
    [1, 3, "等待"],
    [0, 4, "持有"],
    [1, 4, "另一把钥匙"],
  ];
  return {
    status: "ready",
    nodes,
    seedEntities: nodes.slice(0, 2),
    edges: pairs.map(([a, b, label], i) => ({
      id: `${novel.currentNovelId}-edge-${i}`,
      source: nodes[Number(a)].id,
      target: nodes[Number(b)].id,
      linkType: "related",
      label: String(label),
      description: "从演示章节提取的故事关系。",
      strength: 0.8,
      confidence: 0.95,
      validFromChapter: 1,
      validUntilChapter: 2147483647,
      status: "user_confirmed",
      hop: 1,
      score: 0.9,
      includeInPrompt: true,
      evidenceQuote: sourceText,
      evidenceLocation: { chapterNo: 3, lineStart: 3, lineEnd: 3 },
    })),
    contextText: "人物由试探转向合作，线索围绕两把钥匙展开。",
    warnings: [],
    tokenEstimate: 640,
  };
}

export function makeSkill(
  id = "demo-skill",
  title = "有潜台词的对话",
  novelId = "demo-mist",
): WritingSkillCardDetail {
  const card: WritingSkillCardDetail = {
    id,
    libraryId: "demo-mist",
    libraryVersion: "1",
    libraryName: "雾城来信",
    title,
    userInstruction: "研究如何通过动作与停顿写出人物没有说出口的心事。",
    summary: "用动作、停顿和具体物件承载关系变化。",
    applicationScope: "人物试探、悬念场景与克制的情感表达。",
    rules: [
      {
        text: "让角色先回应一个细节，再回应问题。",
        evidenceRefs: ["第 3 章 / 1–3 段"],
      },
      {
        text: "用手上的动作承载没有说出口的选择。",
        evidenceRefs: ["第 3 章 / 3 段"],
      },
    ],
    avoid: ["直接解释全部心理活动", "每句话都附加情绪标签"],
    defaultExampleCount: 1,
    modelConfigId: "demo",
    status: "ACTIVE",
    sourceJobId: null,
    createdAt: seedDate,
    updatedAt: seedDate,
    exampleCount: 1,
    sources: [
      {
        sourceType: "LIBRARY",
        sourceId: "demo-mist",
        sourceName: "雾城来信",
        sourceVersion: "1",
        sourceOrder: 0,
      },
    ],
    examples: [
      {
        id: `${id}-ex`,
        skillCardId: id,
        rangeRef: {
          libraryId: "demo-mist",
          libraryVersion: "1",
          workId: "demo-mist",
          chapterId: "demo-mist-ch-3",
          startParagraphId: "p1",
          endParagraphId: "p3",
        },
        displayRef: "第 3 章 / 1–3 段",
        score: 0.96,
        enabled: true,
        createdAt: seedDate,
        anonymizedText: generatedText,
      },
    ],
  };
  const book = demoBookById[novelId];
  if (book) {
    const chapter = book.scenario.chapter;
    Object.assign(card, { libraryId: novelId, libraryName: book.title, title: book.skill.title,
      userInstruction: book.skill.rule, summary: book.skill.rule, applicationScope: book.tags.join('、'),
      rules: [{text:book.skill.rule,evidenceRefs:[book.chapters[chapter-1].title]}],avoid:[book.skill.avoid],
      sources:[{sourceType:'LIBRARY',sourceId:novelId,sourceName:book.title,sourceVersion:'1',sourceOrder:0}] });
    card.examples[0].rangeRef = {libraryId:novelId,libraryVersion:'1',workId:novelId,chapterId:`${novelId}-ch-${chapter}`,startParagraphId:'p1',endParagraphId:'p3'};
    card.examples[0].displayRef = `${book.chapters[chapter-1].title} / 1–3 段`;
    card.examples[0].anonymizedText = book.chapters[chapter-1].text.split('\n\n').slice(0,3).join('\n\n');
  }
  return card;
}

export { createDefaultPresetCompatLibrary };


export function scenarioFor(novelId: string): DemoScenario {
  const book = demoBookById[novelId];
  if (book) return book.scenario;
  const scenario: DemoScenario = {
    chapter:3, sourceText, instruction:'让主角决定和信使一起赴约，保留钥匙的伏笔。',
    rewriteText:generatedText,continueText:generatedText,whatIfText:generatedText,futureText,
    bridge:'两人从剧院找到旧航海图，一起穿过北岸迷雾，在退潮后抵达灯塔。',
    titles:{rewrite:'一起赴约',continue_block:'走入剧院',what_if:'如果选择留下',future_jump:'灯塔重逢',roleplay_session:'雨夜的对话'},
    delta:{before:'试探',after:'同盟',description:'主角选择留下，两人的关系由试探转向合作。'},
    roleplay:{opening:'你一直在等我吗？',reply:'我答应过一个人，要把钥匙交给你。',narration:'雨水顺着伞沿落下。她握紧另一把钥匙。',
      responses:['好。这一次，我会把知道的都告诉你。']},
  };
  if (novelId === 'demo-star') {
    return JSON.parse(JSON.stringify(scenario).replaceAll('林舟','许澄').replaceAll('沈遥','叶星').replaceAll('灯塔','信标站').replaceAll('渡口','空间港').replaceAll('铜钥匙','航行密钥').replaceAll('剧院','观测站').replaceAll('何叔','老船长'));
  }
  return scenario;
}
