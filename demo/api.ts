/* eslint-disable @typescript-eslint/no-explicit-any */
// Only the HTTP boundary is dynamic. Pages, stores, schemas and UI are upstream ReTale.
import {
  makeNovel,
  makeSettings,
  makeGraph,
  makeSkill,
  createDefaultPresetCompatLibrary,
  seedDate,
  sourceText,
  generatedText,
  futureText,
} from "./fixtures";
import {
  normalizeWorkspaceState,
  createEmptyWorkspaceState,
} from "@/lib/workspace-state";
import { importNovelIntoWorkspace } from "@/lib/server/import-txt";
import { htmlToPlainText } from "@/lib/utils";
import {
  normalizePresetCompatPresetImport,
  normalizePresetCompatStandaloneRegexImport,
} from "@/lib/preset-compat/normalize";

type Row = Record<string, any>;
type Database = {
  version: number;
  novels: Record<string, ReturnType<typeof makeNovel>>;
  metadata: Record<string, Row>;
  revisions: Record<string, number>;
  nodes: Row[];
  details: Record<string, Row>;
  jobs: Record<string, Row>;
  knowledge: Record<string, Row>;
  graphs: Record<string, ReturnType<typeof makeGraph>>;
  compressions: Record<string, number>;
  settings: ReturnType<typeof makeSettings>;
  presets: ReturnType<typeof createDefaultPresetCompatLibrary>;
  skills: Record<string, ReturnType<typeof makeSkill>>;
  materials: Row[];
};
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const branchId = (novelId: string) => `${novelId}-main`;

function emptyDatabase(): Database {
  const novels = {
    "demo-mist": makeNovel("demo-mist", "雾城来信"),
    "demo-star": makeNovel("demo-star", "星海回声"),
  };
  return {
    version: 1,
    novels,
    metadata: {},
    revisions: { "demo-mist": 1, "demo-star": 1 },
    nodes: [],
    details: {},
    jobs: {},
    knowledge: {},
    graphs: Object.fromEntries(
      Object.entries(novels).map(([key, novel]) => [key, makeGraph(novel)]),
    ),
    compressions: {},
    settings: makeSettings(),
    presets: createDefaultPresetCompatLibrary(),
    skills: {
      "demo-skill": makeSkill(),
      "demo-skill-2": makeSkill("demo-skill-2", "用环境推进悬念"),
    },
    materials: [],
  };
}

export function createDemoApi(
  saved: string | null = null,
  persist: (value: string) => void = () => {},
) {
  let db = emptyDatabase();
  let restored = false;
  try {
    const parsed = saved ? JSON.parse(saved) : null;
    if (
      parsed?.version === 1 &&
      parsed.novels &&
      parsed.details &&
      parsed.nodes &&
      parsed.presets
    ) {
      db = parsed;
      restored = true;
    }
  } catch {
    /* An invalid browser snapshot is replaced with the fictional seed. */
  }
  const save = () => persist(JSON.stringify(db));
  const revisionHeaders = (novelId: string) => ({
    "X-Retale-Workspace-Revision": String(db.revisions[novelId] || 1),
    "X-Retale-Revision-Novel-Id": novelId,
  });
  const json = (
    value: any,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    Response.json(value, {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    });
  const success = (extra: Row = {}) => json({ ok: true, ...extra });

  function addNode(
    novelId: string,
    type: string,
    body: Row,
    seededId?: string,
  ) {
    const detailId = seededId || id(type);
    const nodeId = `${detailId}-node`;
    const chapterNo = Number(
      body.sourceChapterNo || body.sourceContext?.chapterNo || 3,
    );
    const selected = body.selectedText || sourceText;
    const text = body.generatedText || generatedText;
    const instruction =
      body.userInstruction || "让主角决定和信使一起赴约，保留钥匙的伏笔。";
    const label =
      (
        {
          rewrite: "RE",
          continue_block: "CONT",
          what_if: "IF",
          future_jump: "JUMP",
          roleplay_session: "RP",
        } as Row
      )[type] +
      "-" +
      String(
        db.nodes.filter((n) => n.novelId === novelId && n.nodeType === type)
          .length + 1,
      ).padStart(2, "0");
    const title =
      body.titleHint ||
      (
        {
          rewrite: "一起赴约",
          continue_block: "走入剧院",
          what_if: "如果选择留下",
          future_jump: "灯塔重逢",
          roleplay_session: "雨夜的对话",
        } as Row
      )[type];
    const node: Row = {
      type: "branch_node",
      id: nodeId,
      novelId,
      branchId: branchId(novelId),
      nodeType: type,
      readableLabel: label,
      readableLineageLabel: label,
      anchorChapterNo: chapterNo,
      parentNodeId: body.parentTimelineNodeId || null,
      title,
      subtitle: instruction,
      laneIndex: 0,
      colorToken: "violet",
      sourceChapterNo: chapterNo,
      targetChapterNo:
        type === "future_jump" ? Number(body.targetChapterNo || 8) : null,
      continueBlockId: ["rewrite", "continue_block"].includes(type)
        ? detailId
        : null,
      whatIfSessionId: type === "what_if" ? detailId : null,
      futureJumpRunId: type === "future_jump" ? detailId : null,
      roleplaySessionId: type === "roleplay_session" ? detailId : null,
      currentText: text,
      latestText: text,
      latestRevisionNo: 1,
      userInstruction: instruction,
      selectedText: selected,
      originalText: body.originalText || selected,
      inputTokens: 640,
      outputTokens: 320,
      writingSkillCardIds: body.writingSkillCardIds || [],
      writingSkillExampleCount: 1,
      status: "ready",
      createdAt: seedDate,
      updatedAt: seedDate,
    };
    const revision: Row = {
      id: `${detailId}-rev-1`,
      continueBlockId: detailId,
      runId: detailId,
      revisionNo: 1,
      revisionKind: "create",
      userInstruction: instruction,
      userFeedback: null,
      selectedText: selected,
      originalText: body.originalText || selected,
      generatedText: text,
      generatedTargetText: futureText,
      bridgeSummary:
        "两人从剧院找到旧航海图，一起穿过北岸迷雾，在退潮后抵达灯塔。",
      title,
      subtitle: instruction,
      inputTokens: 640,
      outputTokens: 320,
      createdAt: seedDate,
    };
    const chapter =
      db.novels[novelId]?.localChapters.find((c) => c.order === chapterNo) ||
      db.novels[novelId]?.localChapters[0];
    const detail: Row = {
      id: detailId,
      novelId,
      branchId: branchId(novelId),
      baseBranchId: branchId(novelId),
      parentTimelineNodeId: node.parentNodeId,
      sourceChapterNo: chapterNo,
      title,
      subtitle: instruction,
      userInstruction: instruction,
      premise: instruction,
      selectedText: selected,
      originalText: selected,
      latestText: text,
      generatedText: text,
      inputTokens: 640,
      outputTokens: 320,
      writingSkillCardIds: [],
      writingSkillExampleCount: 1,
      latestRevisionNo: 1,
      status: "ready",
      createdAt: seedDate,
      updatedAt: seedDate,
      timelineNodeId: nodeId,
      latestRevision: revision,
      revisionHistory: [revision],
      revisions: [revision],
      deltas: [
        {
          id: `${detailId}-delta`,
          sessionId: detailId,
          deltaType: "relationship",
          subjectName: "林舟",
          targetName: "沈遥",
          subjectEntityId: null,
          targetEntityId: null,
          key: "trust",
          oldValue: "试探",
          newValue: "同盟",
          validFromChapter: chapterNo,
          description: "主角选择留下，两人的关系由试探转向合作。",
          confidence: 0.95,
          createdAt: seedDate,
        },
      ],
      sourceContext: body.sourceContext || {
        nodeId: null,
        nodeType: "chapter",
        chapterId: chapter?.id,
        chapterNo,
        whatIfSessionId: null,
      },
      sourceTextSnapshot: chapter ? htmlToPlainText(chapter.content) : selected,
      targetOutlineNodeId: body.targetOutlineNodeId || `${novelId}-future-8`,
      targetOutlineChapterId:
        body.targetOutlineChapterId || `${novelId}-link-8`,
      targetChapterNo: node.targetChapterNo,
      userDirection: body.userDirection || "两人一起抵达灯塔。",
      bridgeSummary: revision.bridgeSummary,
      generatedTargetText: futureText,
      errorMessage: null,
      sourceChapterId: chapter?.id,
      sourceChapterTitle: chapter?.title,
      sourceTimelineNodeId: body.sourceTimelineNodeId || null,
      sourceTimelineNodeType: body.sourceTimelineNodeType || "chapter",
      sourceSelectedText: selected,
      sourceSelectedLineStart: null,
      sourceSelectedLineEnd: null,
      messages: [],
      characterOptions:
        db.novels[novelId]?.localCharacters.map((c) => ({
          name: c.name,
          protagonist: c.importanceTier === "protagonist",
        })) || [],
    };
    detail.sourceSnapshot = {
      chapterId: chapter?.id,
      chapterNo,
      chapterTitle: chapter?.title,
      timelineNodeId: null,
      timelineNodeType: "chapter",
      selectedText: selected,
      textSnapshot: detail.sourceTextSnapshot,
      selectedLineStart: null,
      selectedLineEnd: null,
    };
    db.nodes.push(node);
    db.details[detailId] = detail;
    return { node, detail };
  }

  function appendMessage(detail: Row, body: Row) {
    const original = detail.messages.find(
      (m: Row) => m.id === body.sourceMessageId,
    );
    const parentId = body.parentMessageId ?? original?.parentMessageId ?? null;
    const variants = detail.messages.filter(
      (m: Row) => m.parentMessageId === parentId && m.role === body.role,
    );
    const index = detail.messages.length;
    const message: Row = {
      ...body,
      id: id("message"),
      sessionId: detail.id,
      messageIndex: index + 1,
      turnIndex: Math.floor(index / 2) + 1,
      variantIndex: variants.length + 1,
      variantGroupId: parentId,
      parentMessageId: parentId,
      forkedFromMessageId: body.forkedFromMessageId || null,
      status: "completed",
      createdAt: now(),
      updatedAt: now(),
    };
    message.variantMetadata = {
      turnIndex: message.turnIndex,
      variantIndex: message.variantIndex,
      variantGroupId: message.variantGroupId,
    };
    message.forkMetadata = {
      parentMessageId: message.parentMessageId,
      forkedFromMessageId: message.forkedFromMessageId,
    };
    detail.messages.push(message);
    return message;
  }

  if (!restored) {
    for (const novelId of Object.keys(db.novels)) {
      const rewrite = addNode(novelId, "rewrite", {}, `${novelId}-rewrite`);
      addNode(
        novelId,
        "continue_block",
        { parentTimelineNodeId: rewrite.node.id },
        `${novelId}-continue`,
      );
      const whatif = addNode(novelId, "what_if", {}, `${novelId}-whatif`);
      addNode(
        novelId,
        "future_jump",
        { parentTimelineNodeId: whatif.node.id },
        `${novelId}-future`,
      );
      const { detail } = addNode(
        novelId,
        "roleplay_session",
        {},
        `${novelId}-roleplay`,
      );
      const [player, counterpart] = db.novels[novelId].localCharacters;
      const user = appendMessage(detail, {
        role: "user",
        content: "你一直在等我吗？",
        turn: {
          playerName: player.name,
          counterpartName: counterpart.name,
          storyGuidance: "在雨夜的剧院门口相遇。",
          dialogue: "你一直在等我吗？",
          maxCharacters: 600,
        },
      });
      appendMessage(detail, {
        role: "assistant",
        content: "雨水顺着伞沿落下。\n“我答应过一个人，要把钥匙交给你。”",
        parentMessageId: user.id,
        script: {
          playerName: player.name,
          counterpartName: counterpart.name,
          blocks: [
            { type: "narration", text: "雨水顺着伞沿落下。她握紧另一把钥匙。" },
            { type: "counterpart", text: "“我答应过一个人，要把钥匙交给你。”" },
          ],
        },
      });
    }
  }

  function compression(scope: Row) {
    const key = JSON.stringify(scope);
    const count = db.nodes.filter((n) => n.novelId === scope.novelId).length;
    const compressed = Math.min(db.compressions[key] || 0, count);
    return {
      scope,
      fingerprint: `demo-${count}`,
      totalChapters: count,
      compressedChapters: compressed,
      chapters: Array.from({ length: count }, (_, i) => ({
        label: `生成历史 ${i + 1}`,
        tokenEstimate: 1500,
      })),
      summary: compressed
        ? "主角与信使选择合作，在旧剧院找到航海图，准备前往灯塔。"
        : null,
      tokenEstimate: count * 1500,
    };
  }

  function preview(novelId: string, body: Row) {
    const novel = db.novels[novelId] || Object.values(db.novels)[0];
    const chapter =
      novel?.localChapters.find((c) => c.id === body.chapterId) ||
      novel?.localChapters[2] ||
      novel?.localChapters[0];
    const scope = {
      novelId,
      branchId: body.branchId || branchId(novelId),
      ...(body.branchContextNodeId
        ? { branchContextNodeId: body.branchContextNodeId }
        : {}),
      ...(body.roleplaySessionId
        ? { roleplaySessionId: body.roleplaySessionId }
        : {}),
    };
    const disabled =
      body.disabledBlockIds ||
      body.roleplayTurn?.generationOptions?.disabledBlockIds ||
      [];
    const blocks = [
      {
        id: "source-text",
        label: "原文片段",
        enabled: true,
        required: true,
        priority: "highest",
        content:
          body.selectedText ||
          (chapter && htmlToPlainText(chapter.content)) ||
          sourceText,
      },
      {
        id: "characters",
        label: "人物与关系",
        enabled: !disabled.includes("characters"),
        required: false,
        priority: "high",
        content:
          novel?.localCharacters
            .map((c) => `${c.name}：${c.note}`)
            .join("\n") || "",
      },
      {
        id: "history",
        label: "生成历史",
        enabled: !disabled.includes("history"),
        required: false,
        priority: "medium",
        content: generatedText,
      },
    ];
    const promptBlocks = blocks.map((b) => ({ ...b, trimmed: false }));
    const systemPrompt =
      "这是 ReTale 静态演示中的模拟上下文；保持人物关系、伏笔和叙事风格。";
    const userPrompt =
      promptBlocks
        .filter((b) => b.enabled)
        .map((b) => `${b.label}\n${b.content}`)
        .join("\n\n") + `\n${body.userInstruction || ""}`;
    return {
      ok: true,
      novelId,
      branchId: scope.branchId,
      chapterId: chapter?.id,
      chapterNo: chapter?.order || 3,
      chapterTitle: chapter?.title,
      warnings: [],
      promptBlocks,
      assembledContext: userPrompt,
      graphContext: db.graphs[novelId] || {
        nodes: [],
        edges: [],
        seedEntities: [],
        status: "ready",
        warnings: [],
        contextText: "",
        tokenEstimate: 0,
      },
      lanceEvidence: chapter
        ? [
            {
              id: "demo-evidence",
              sourceType: "chapter",
              sourceId: chapter.id,
              chapterId: chapter.id,
              chapterNo: chapter.order,
              lineStart: 1,
              lineEnd: 3,
              title: chapter.title,
              sourceLabel: "原文",
              text: htmlToPlainText(chapter.content),
              score: 0.94,
            },
          ]
        : [],
      tokenEstimate: 1280,
      contextSnapshotId: "demo-context",
      systemPrompt,
      userPrompt,
      requestMessages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      writingSkillRecords: [],
      compression: compression(scope),
    };
  }

  function knowledge(novelId: string) {
    const novel = db.novels[novelId];
    const count = novel?.localChapters.length || 0;
    const state = db.knowledge[novelId] || {};
    const coverage = {
      status: state.deleted ? "missing" : "full",
      coveredChapterCount: state.deleted ? 0 : count,
      totalChapterCount: count,
      validThroughChapterNo: state.deleted ? null : count,
    };
    return {
      ok: true,
      localOutlines: novel?.localOutlines || [],
      localCharacters: novel?.localCharacters || [],
      localCharacterRelations: novel?.localCharacterRelations || [],
      localWorldEntries: novel?.localWorldEntries || [],
      localTimelineEvents: novel?.localTimelineEvents || [],
      knowledgeRebuildStatus: state.job || null,
      hanlpCacheSnapshot: { status: state.hanlpDeleted ? "empty" : "ready" },
      knowledgeStatusOverview: {
        knowledgeGraph: coverage,
        extractionCache: state.extractionDeleted
          ? { ...coverage, status: "missing", coveredChapterCount: 0 }
          : coverage,
        embeddingCache: {
          ...coverage,
          status: state.embeddingDeleted ? "missing" : coverage.status,
          provider: "openai-compatible",
          model: "ReTale Dummy Model",
        },
        retrievalIndex: {
          status: state.deleted ? "missing" : "full",
          indexedScopeCount: state.deleted ? 0 : 1,
          task:
            state.job?.jobType === "rebuild_retrieval_index" ? state.job : null,
        },
      },
      jobOutcome: null,
      actionError: null,
    };
  }

  function futureMap(novelId: string) {
    const chapters = db.novels[novelId]?.localChapters || [];
    const events = chapters.map((c) => ({
      id: `${novelId}-future-${c.order}`,
      chapterNo: c.order,
      title: c.title,
      summary: htmlToPlainText(c.content).slice(0, 100),
      originalOutcome: "沿着线索抵达下一站。",
      trackKey: "main",
      phaseLabel: "主线",
      sourceType: "chapter_summary",
      confidence: 0.98,
      sortOrder: c.order,
    }));
    return {
      novelId,
      branchId: branchId(novelId),
      tracks: [
        {
          trackKey: "main",
          phaseLabel: "主线",
          eventCount: events.length,
          sourceTypes: ["chapter_summary"],
        },
      ],
      events,
      chaptersByEvent: Object.fromEntries(
        chapters.map((c) => [
          `${novelId}-future-${c.order}`,
          [
            {
              id: `${novelId}-link-${c.order}`,
              outlineNodeId: `${novelId}-future-${c.order}`,
              chapterNo: c.order,
              chapterId: c.id,
              chapterTitle: c.title,
              isPrimary: true,
              sortOrder: c.order,
              createdAt: seedDate,
              updatedAt: seedDate,
            },
          ],
        ]),
      ),
      defaults: {
        selectedTrackKey: "main",
        selectedOutlineNodeId: events.at(-1)?.id || null,
      },
    };
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const method = request.method;
    let body: Row = {};
    let form: FormData | undefined;
    if (!["GET", "HEAD"].includes(method)) {
      try {
        if (
          request.headers.get("content-type")?.includes("multipart/form-data")
        )
          form = await request.formData();
        else body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid demo request" }, 400);
      }
    }
    const novelId = String(
      body.novelId ||
        url.searchParams.get("novelId") ||
        (parts[1] === "novels" ? parts[2] : "") ||
        "demo-mist",
    );
    const novel = db.novels[novelId];
    const commit = (value: any, headers: Record<string, string> = {}) => {
      save();
      return json(value, 200, headers);
    };
    if (parts[1] === "novels" && !parts[2])
      return success({
        novels: Object.entries(db.novels).map(([key, value]) => ({
          ...value.localNovels[0],
          author: "ReTale Demo",
          coverImage: "",
          knowledgeStatus: db.knowledge[key]?.deleted ? "missing" : "ready",
          updatedAt: seedDate,
          wordCount: value.localChapters.reduce((n, c) => n + c.wordCount, 0),
          chapterCount: value.localChapters.length,
          firstChapterId: value.localChapters[0]?.id || null,
          ...db.metadata[key],
        })),
      });
    if (parts[1] === "novels" && parts[3] === "search") {
      if (url.searchParams.has("capabilities"))
        return success({ semanticAvailable: true });
      const q = url.searchParams.get("q") || "";
      const mode = url.searchParams.get("mode") || "exact";
      const matches = (novel?.localChapters || [])
        .flatMap((c) =>
          htmlToPlainText(c.content)
            .split("\n\n")
            .map((text, i) => ({
              chapterId: c.id,
              chapterNo: c.order,
              chapterTitle: c.title,
              text,
              searchText: text,
              lineStart: i + 1,
              lineEnd: i + 1,
              kind: mode,
              sourceType: "chapter",
            })),
        )
        .filter((m) =>
          mode === "exact"
            ? m.text.toLowerCase().includes(q.toLowerCase())
            : q.split("").some((char) => char.trim() && m.text.includes(char)),
        )
        .slice(0, 40);
      return json({
        query: q,
        mode,
        fallback: false,
        limited: matches.length === 40,
        matches,
      });
    }
    if (parts[1] === "novels" && parts[2]) {
      if (!novel) return json({ ok: false, error: "Novel not found" }, 404);
      if (method === "GET")
        return json(
          {
            ...novel,
            workspaceRevision: db.revisions[novelId] || 1,
            revisionNovelId: novelId,
          },
          200,
          revisionHeaders(novelId),
        );
      if (method === "DELETE") {
        delete db.novels[novelId];
        db.nodes = db.nodes.filter((n) => n.novelId !== novelId);
        return commit({
          ok: true,
          deletedNovelId: novelId,
          nextNovelId: Object.keys(db.novels)[0] || null,
          deletionState: "deleted",
          cleanupPending: false,
        });
      }
      if (method === "PATCH" && form) {
        db.metadata[novelId] = {
          ...db.metadata[novelId],
          title: String(form.get("title") || novel.localNovels[0].title),
          author: String(form.get("author") || ""),
        };
        novel.localNovels[0].title = db.metadata[novelId].title;
        const cover = form.get("cover");
        if (cover instanceof File) {
          const bytes = new Uint8Array(await cover.arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          db.metadata[novelId].coverImage =
            `data:${cover.type};base64,${btoa(binary)}`;
        }
        if (form.get("removeCover") === "1")
          db.metadata[novelId].coverImage = "";
        return commit({ ok: true, ...db.metadata[novelId] });
      }
      if (method === "POST") {
        const chapters = (body.localChapters || novel.localChapters).map(
          (c: Row) => ({
            ...novel.localChapters.find((old) => old.id === c.id),
            ...c,
            ...(c.contentLoaded === false
              ? {
                  content:
                    novel.localChapters.find((old) => old.id === c.id)
                      ?.content || "",
                }
              : {}),
          }),
        );
        db.novels[novelId] = normalizeWorkspaceState({
          ...novel,
          ...body,
          localChapters: chapters,
        });
        db.revisions[novelId] = (db.revisions[novelId] || 1) + 1;
        return commit(
          { ok: true, revision: db.revisions[novelId], novelId },
          revisionHeaders(novelId),
        );
      }
    }
    if (parts[1] === "chapters" && method === "PATCH") {
      const owner = Object.values(db.novels).find((n) =>
        n.localChapters.some((c) => c.id === parts[2]),
      );
      const chapter = owner?.localChapters.find((c) => c.id === parts[2]);
      if (!chapter || !owner)
        return json({ ok: false, error: "Chapter not found" }, 404);
      Object.assign(chapter, {
        content: body.content,
        wordCount: body.wordCount,
        updatedAt: body.updatedAtLabel || now(),
      });
      const key = owner.currentNovelId;
      db.revisions[key] = (db.revisions[key] || 1) + 1;
      return commit(
        { ok: true, revision: db.revisions[key], novelId: key },
        revisionHeaders(key),
      );
    }
    if (parts[1] === "import-txt" && form) {
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        return json({ ok: false, error: "请选择 10 MiB 以内的 TXT 文件" }, 400);
      const text = await file.text();
      if (!text.trim()) return json({ ok: false, error: "文件为空" }, 400);
      const state = normalizeWorkspaceState(
        importNovelIntoWorkspace(createEmptyWorkspaceState(), {
          title: file.name.replace(/\.txt$/i, ""),
          text,
        }),
      );
      db.novels[state.currentNovelId] = state;
      db.revisions[state.currentNovelId] = 1;
      return commit({
        ok: true,
        novelId: state.currentNovelId,
        chapterId: state.currentChapterId,
        chapterCount: state.localChapters.length,
        revision: 1,
      });
    }
    if (parts[1] === "settings" && parts[2] === "ai") {
      if (parts[3] === "openai-models" || parts[3] === "ollama-models")
        return success({
          models: [
            {
              id: "ReTale Dummy Model",
              name: "ReTale Dummy Model",
              model: "ReTale Dummy Model",
            },
          ],
        });
      if (parts[3] === "local-embedding")
        return success({
          available: false,
          installed: false,
          running: false,
          status: "demo",
          models: [],
          message: "静态演示使用内置检索结果。",
        });
      if (method === "POST") {
        db.settings = body as Database["settings"];
        return commit({ ok: true });
      }
      return json(db.settings);
    }
    if (parts[1] === "settings" && parts[2] === "preset-compat") {
      if (parts[3] === "import") {
        let payload;
        try {
          payload = JSON.parse(body.jsonText);
        } catch {
          return json({ ok: false, error: "JSON 格式无效" }, 400);
        }
        const importedIds: string[] = [];
        let warnings: string[] = [];
        if (body.kind === "regex") {
          const value = normalizePresetCompatStandaloneRegexImport(payload);
          warnings = value.warnings;
          for (const regex of value.regexes) {
            db.presets.standaloneRegexes[regex.id] = regex;
            importedIds.push(regex.id);
          }
        } else {
          const value = normalizePresetCompatPresetImport(payload);
          warnings = value.warnings;
          db.presets.presets[value.preset.id] = value.preset;
          importedIds.push(value.preset.id);
        }
        db.presets.revision++;
        return commit({ ok: true, library: db.presets, importedIds, warnings });
      }
      if (method === "POST") {
        db.presets = body.library;
        db.presets.revision++;
        return commit({ ok: true, library: db.presets });
      }
      return json(db.presets);
    }
    if (parts[1] === "knowledge-view") {
      if (method === "POST") {
        const previous = db.knowledge[novelId] || {};
        if (body.action.startsWith("delete-")) {
          db.knowledge[novelId] = {
            ...previous,
            [(
              {
                "delete-knowledge": "deleted",
                "delete-hanlp-cache": "hanlpDeleted",
                "delete-extraction-cache": "extractionDeleted",
                "delete-embedding-cache": "embeddingDeleted",
              } as Row
            )[body.action]]: true,
          };
        } else {
          db.knowledge[novelId] = {
            job: {
              jobId: id("knowledge"),
              novelId,
              jobType:
                body.action === "rebuild-retrieval-index"
                  ? "rebuild_retrieval_index"
                  : "extract_chapter_knowledge",
              status:
                body.action === "pause"
                  ? "paused"
                  : body.action === "abort"
                    ? "aborted"
                    : "completed",
              progress: 1,
              currentStep: "演示知识处理完成",
              createdAt: now(),
              updatedAt: now(),
              etaMinutes: null,
              steps: ["hanlp-bootstrap", "extract", "write", "index"].map(
                (key) => ({
                  key,
                  label: key,
                  status: "completed",
                  progress: 1,
                  etaMinutes: null,
                  detail: "内置 dummy 结果",
                }),
              ),
            },
          };
        }
        save();
      }
      return json(knowledge(novelId));
    }
    if (parts[1] === "story-timeline") {
      if (method === "DELETE") {
        const ids = new Set([body.nodeId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of db.nodes)
            if (n.parentNodeId && ids.has(n.parentNodeId) && !ids.has(n.id)) {
              ids.add(n.id);
              changed = true;
            }
        }
        db.nodes = db.nodes.filter((n) => !ids.has(n.id));
        return commit({ ok: true, nodeId: body.nodeId });
      }
      const nodes = db.nodes.filter((n) => n.novelId === novelId);
      return json({
        novelId,
        branchId: branchId(novelId),
        chapters: (novel?.localChapters || []).map((c) => ({
          type: "chapter",
          chapterId: c.id,
          chapterNo: c.order,
          title: c.title,
          wordCount: c.wordCount,
          summary: htmlToPlainText(c.content).slice(0, 24) + "…",
        })),
        branchNodes: nodes,
        edges: nodes
          .filter((n) => n.parentNodeId)
          .map((n) => ({ fromNodeId: n.parentNodeId, toNodeId: n.id })),
      });
    }
    if (parts[1] === "story-future-map") return json(futureMap(novelId));
    if (
      parts[1] === "rag" ||
      (parts[1] === "roleplay" && parts[2] === "preview") ||
      (parts[1] === "future-jump" && parts[2] === "preview")
    )
      return json(
        preview(novelId, { ...Object.fromEntries(url.searchParams), ...body }),
      );
    if (parts[1] === "context-preview")
      return success({ preview: preview(novelId, body) });
    if (parts[1] === "context" && parts[2] === "compress") {
      db.compressions[JSON.stringify(body.scope)] =
        method === "DELETE" ? 0 : body.count;
      return commit({ ok: true, compression: compression(body.scope) });
    }
    if (parts[1] === "graph") {
      if (parts[2] === "subgraph") return success(db.graphs[novelId]);
      const edge = db.graphs[novelId]?.edges.find((e) => e.id === parts[3]);
      if (edge) {
        Object.assign(edge, body, {
          status: parts[4] === "reject" ? "rejected" : "user_confirmed",
        });
        return commit({ ok: true, edge });
      }
    }
    if (parts[1] === "rewrite") {
      if (method === "GET")
        return success({
          job: db.jobs[url.searchParams.get("jobId") || ""] || null,
        });
      if (method === "DELETE") {
        const job = db.jobs[url.searchParams.get("jobId") || ""];
        if (job) job.status = "aborted";
        return commit({ ok: true, job: job || null });
      }
      const turn = body.roleplayTurn;
      const content = turn
        ? JSON.stringify({
            blocks: turn.dialogueOnly
              ? [
                  {
                    type: "counterpart",
                    text: "我一直等着把钥匙交给你。你问起那封信的时候，我就知道，你和他一样，不会轻易放弃。\n\n你先留在我身边。走廊尽头的门下面有一束光，也许那就是我们一直在找的答案。",
                  },
                ]
              : [
                  {
                    type: "narration",
                    text: "雨声渐渐远去。她将钥匙放在两人之间，目光落在旧门的锁孔上。",
                  },
                  { type: "player", text: turn.dialogue || "我们一起进去。" },
                  {
                    type: "counterpart",
                    text: "“好。这一次，我会把知道的都告诉你。”",
                  },
                ],
          })
        : generatedText;
      const result = {
        title: "一起赴约",
        summary: "主角选择留下，故事沿着另一种可能展开。",
        content,
        inputTokens: 1280,
        outputTokens: 320,
        provider: "demo",
      };
      if (body.recoverableRewriteJob) {
        const job = {
          jobId: id("rewrite-job"),
          status: "completed",
          progress: 1,
          currentStep: "演示版本已生成",
          errorMessage: null,
          createdAt: now(),
          updatedAt: now(),
          panel: {
            ...body,
            createdAt: now(),
            sourceTextOverride: body.sourceTextOverride || null,
            branchContextNodeId: body.branchContextNodeId || null,
            continueBlockId: body.continueBlockId || null,
          },
          result,
        };
        db.jobs[job.jobId] = job;
        return commit({ ok: true, job });
      }
      return success({
        provider: "demo",
        result,
        candidates: [result],
        metadata: null,
        presetCompat: null,
      });
    }
    if (
      parts[1] === "continue-blocks" ||
      (parts[1] === "what-if" && parts[2] === "sessions") ||
      (parts[1] === "future-jump" && parts[2] === "runs") ||
      (parts[1] === "roleplay" && parts[2] === "sessions")
    ) {
      const kind =
        parts[1] === "continue-blocks"
          ? "continue_block"
          : parts[1] === "what-if"
            ? "what_if"
            : parts[1] === "future-jump"
              ? "future_jump"
              : "roleplay_session";
      const detailId =
        parts[kind === "continue_block" ? 2 : 3] || body.continueBlockId;
      if (!detailId && method === "POST") {
        const target = novel?.localChapters.find(
          (c) => `${novelId}-link-${c.order}` === body.targetOutlineChapterId,
        );
        const nodeKind =
          kind === "continue_block" && !body.parentTimelineNodeId
            ? "rewrite"
            : kind;
        const { node, detail } = addNode(novelId, nodeKind, {
          ...body,
          targetChapterNo: target?.order || 8,
        });
        return commit({
          ...detail,
          ok: true,
          sessionId: detail.id,
          runId: detail.id,
          continueBlockId: detail.id,
          timelineNodeId: node.id,
          nodeType: node.nodeType,
          readableLabel: node.readableLabel,
        });
      }
      const detail = db.details[detailId];
      if (!detail)
        return json({ ok: false, error: "Demo branch not found" }, 404);
      if (parts.at(-1) === "messages") {
        if (method === "DELETE") {
          const removed = new Set<string>([body.messageId]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const m of detail.messages)
              if (removed.has(m.parentMessageId) && !removed.has(m.id)) {
                removed.add(m.id);
                changed = true;
              }
          }
          detail.messages = detail.messages.filter(
            (m: Row) => !removed.has(m.id),
          );
          return commit({ ok: true, deletedMessageIds: [...removed] });
        }
        return commit(appendMessage(detail, body));
      }
      if (method === "PUT" || parts.at(-1) === "revise") {
        const text = body.generatedText || futureText;
        const revision = {
          ...detail.latestRevision,
          revisionNo: detail.latestRevisionNo + 1,
          id: id("revision"),
          revisionKind: "regenerate",
          generatedText: text,
          generatedTargetText: text,
          userFeedback: body.userFeedback || null,
          createdAt: now(),
        };
        Object.assign(detail, {
          latestText: text,
          generatedText: text,
          generatedTargetText: text,
          latestRevisionNo: revision.revisionNo,
          latestRevision: revision,
          revisions: [...detail.revisions, revision],
          revisionHistory: [...detail.revisionHistory, revision],
        });
        const node = db.nodes.find((n) => n.id === detail.timelineNodeId);
        if (node)
          Object.assign(node, {
            latestText: text,
            currentText: text,
            latestRevisionNo: revision.revisionNo,
          });
        return commit({
          ...detail,
          ok: true,
          runId: detail.id,
          continueBlockId: detail.id,
          nodeType: node?.nodeType,
        });
      }
      return json(detail);
    }
    if (parts[1] === "writing-skill-sources")
      return success({
        librarySources: Object.entries(db.novels).map(([key, n]) => ({
          sourceType: "LIBRARY",
          sourceId: key,
          title: n.localNovels[0].title,
          author: "ReTale Demo",
          chapterCount: n.localChapters.length,
          estimatedTokens: n.localChapters.reduce(
            (total, c) => total + c.wordCount,
            0,
          ),
          createdAt: seedDate,
          updatedAt: seedDate,
        })),
        uploadedSources: db.materials,
        model: {
          modelConfigId: "demo",
          provider: "openai-compatible",
          model: "ReTale Dummy Model",
        },
      });
    if (parts[1] === "writing-skill-materials") {
      if (method === "DELETE") {
        db.materials = db.materials.filter((m) => m.sourceId !== parts[2]);
        return commit({ ok: true });
      }
      const file = form?.get("file");
      if (!(file instanceof File))
        return json({ ok: false, error: "Missing file" }, 400);
      const material = {
        sourceId: id("material"),
        sourceType: "UPLOAD",
        title: file.name,
        author: null,
        chapterCount: 1,
        estimatedTokens: (await file.text()).length,
        createdAt: now(),
        updatedAt: now(),
      };
      db.materials.push(material);
      return commit({ ok: true, material });
    }
    if (parts[1] === "writing-skills" || parts[1] === "material-libraries") {
      const cardId = parts[1] === "writing-skills" ? parts[2] : undefined;
      if (method === "DELETE") {
        delete db.skills[cardId!];
        return commit({ ok: true });
      }
      if (method === "PATCH") {
        Object.assign(db.skills[cardId!], body);
        return commit({ ok: true, card: db.skills[cardId!] });
      }
      if (method === "POST") {
        const card = cardId
          ? db.skills[cardId]
          : makeSkill(
              id("skill"),
              body.instruction?.slice(0, 24) || "新的写作技巧",
            );
        card.userInstruction =
          body.instruction || body.userInstruction || card.userInstruction;
        db.skills[card.id] = card;
        const job = {
          id: id("skill-job"),
          libraryId: "demo-mist",
          libraryVersion: "1",
          userInstruction: card.userInstruction,
          modelConfigId: "demo",
          status: "COMPLETED",
          message: "模拟提炼完成",
          randomSeed: 1,
          roundCount: 1,
          sampledRanges: [],
          candidateRefs: [],
          candidateCount: 2,
          inputTokens: 1280,
          outputTokens: 320,
          errorMessage: null,
          resultCardId: card.id,
          createdAt: now(),
          updatedAt: now(),
          card,
        };
        db.jobs[job.id] = job;
        return commit({ ok: true, jobId: job.id, job });
      }
      return success(
        cardId
          ? { card: db.skills[cardId] }
          : {
              cards: Object.values(db.skills).filter(
                (c) =>
                  !url.searchParams.has("status") ||
                  c.status === url.searchParams.get("status"),
              ),
            },
      );
    }
    if (parts[1] === "writing-skill-jobs")
      return success({ job: db.jobs[parts[2]] });
    if (parts[1] === "task")
      return success({
        tasks: Object.values(db.knowledge).flatMap((k) =>
          k.job
            ? [
                {
                  ...k.job,
                  novelTitle: db.novels[k.job.novelId]?.localNovels[0]?.title,
                },
              ]
            : [],
        ),
      });
    return json(
      { ok: false, error: `此演示接口尚未实现：${method} ${url.pathname}` },
      501,
    );
  }
  return { handle, snapshot: () => JSON.stringify(db) };
}
