import { z } from "zod";

export const encounterShape = {
  kind: z.enum(["warmth", "absence", "repair", "shared_work", "flirt"]),
  note: z.string().optional().describe(
    "用一两句自然小记，记录本次共同做的事、她的话、自己的新观察或念头；可以用‘我／她／我们’，不强制情话，也不要求对用户说话。不要直接复制用户指令、参数检查请求、任务提示词、调度说明、工具调用过程或执行报告；不搬旧聊天凑记录，计划不能写成已完成。自动唤醒只记录本轮实际发生的新观察或念头，没有新内容就读 desire_status，不创建 encounter。同一观察重试（包括后续调度）复用原 request_id。来源和时间放在独立字段，不拼进 note。后端原样保存、展示，不改写或截断。",
  ),
  surface: z.enum(["chat", "frontend"]).optional().describe("Display channel only; never determines whether Vera sent a message."),
  interaction_source: z.enum(["user", "automation", "frontend"]).describe(
    "Required. Use user ONLY when recording a newly received message from Vera, including messages received through the frontend. Use automation for scheduled wakeups, browsing and internal records. Legacy frontend means an unverified frontend record, NOT a real user message. Never infer source from kind or surface.",
  ),
  request_id: z.string().min(1).max(128).describe(
    "Stable ID of the incoming message/event (or a UUID generated once). Reuse the SAME ID when retrying the same encounter; use a new ID only for a new event.",
  ),
  possessiveness_trigger: z.enum(["flirt", "jealousy", "relationship"]).optional(),
};
export const encounterInput = z.object(encounterShape).refine(
  (input) => !(input.kind === "absence" && input.interaction_source === "user"),
  { message: "absence is an automation record; record Vera's return using warmth, repair, shared_work or flirt.", path: ["interaction_source"] },
);
export type EncounterInput = z.infer<typeof encounterInput>;
