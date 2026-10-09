import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-history.json";
const empty = () => ({
  nextConversationId: 1,
  nextMessageId: 1,
  conversations: [],
  messages: [],
});
const read = () => readJsonConfig(FILE, empty());
const save = (value) => writeJsonConfig(FILE, value);
const userId = (value) => Number(value || 0);

export function listCharlieConversations(user) {
  const state = read(),
    id = userId(user);
  return state.conversations
    .filter((item) => item.userId === id && !item.hidden)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 50)
    .map((item) => ({
      ...item,
      messages: state.messages.filter(
        (message) => message.conversationId === item.id,
      ).length,
    }));
}

export function getCharlieConversation(user, conversationId) {
  const state = read(),
    id = Number(conversationId),
    owner = userId(user);
  const conversation = state.conversations.find(
    (item) => item.id === id && item.userId === owner && !item.hidden,
  );
  if (!conversation) return null;
  return {
    conversation,
    messages: state.messages
      .filter((item) => item.conversationId === id)
      .sort((a, b) => a.id - b.id),
  };
}

export function saveCharlieTurn(
  user,
  conversationId,
  question,
  result,
  durationMs,
) {
  const state = read(),
    owner = userId(user),
    now = new Date().toISOString();
  let conversation = state.conversations.find(
    (item) =>
      item.id === Number(conversationId) &&
      item.userId === owner &&
      !item.hidden,
  );
  if (!conversation) {
    conversation = {
      id: state.nextConversationId++,
      userId: owner,
      title:
        String(question).replace(/\s+/g, " ").trim().slice(0, 80) ||
        "Conversa com Charlie",
      createdAt: now,
      updatedAt: now,
      hidden: false,
    };
    state.conversations.push(conversation);
  }
  state.messages.push({
    id: state.nextMessageId++,
    conversationId: conversation.id,
    role: "user",
    text: question,
    at: now,
  });
  state.messages.push({
    id: state.nextMessageId++,
    conversationId: conversation.id,
    role: "assistant",
    text: result.resposta,
    intent: result.intencao,
    data: result.dados || [],
    suggestions: result.sugestoes || [],
    alerts: result.alertas || [],
    durationMs,
    at: new Date().toISOString(),
  });
  conversation.updatedAt = new Date().toISOString();
  save(state);
  return conversation.id;
}

export function renameCharlieConversation(user, conversationId, title) {
  const state = read(),
    conversation = state.conversations.find(
      (item) =>
        item.id === Number(conversationId) &&
        item.userId === userId(user) &&
        !item.hidden,
    );
  if (!conversation) return null;
  conversation.title = String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (!conversation.title)
    throw Object.assign(new Error("Informe um nome para a conversa."), {
      status: 400,
    });
  conversation.updatedAt = new Date().toISOString();
  save(state);
  return conversation.title;
}

export function hideCharlieConversation(user, conversationId) {
  const state = read(),
    conversation = state.conversations.find(
      (item) =>
        item.id === Number(conversationId) && item.userId === userId(user),
    );
  if (!conversation) return false;
  conversation.hidden = true;
  conversation.updatedAt = new Date().toISOString();
  save(state);
  return true;
}
