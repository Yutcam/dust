import { ModelId } from "@app/lib/databases";
import { UserType, WorkspaceType } from "@app/types/user";

import { RetrievalActionType } from "./actions/retrieval";
import { AgentConfigurationType } from "./agent";

/**
 * Mentions
 */

export type AgentMention = {
  configurationId: string;
};

export type UserMention = {
  provider: string;
  providerId: string;
};

export type MentionType = AgentMention | UserMention;

export type MessageVisibility = "visible" | "deleted";

export function isAgentMention(arg: MentionType): arg is AgentMention {
  return (arg as AgentMention).configurationId !== undefined;
}

export function isUserMention(arg: MentionType): arg is UserMention {
  const maybeUserMention = arg as UserMention;
  return (
    maybeUserMention.provider !== undefined &&
    maybeUserMention.providerId !== undefined
  );
}

/**
 * User messages
 */

export type UserMessageContext = {
  username: string;
  timezone: string;
  fullName: string | null;
  email: string | null;
  profilePictureUrl: string | null;
};

export type UserMessageType = {
  id: ModelId;
  type: "user_message";
  sId: string;
  visibility: MessageVisibility;
  version: number;
  user: UserType | null;
  mentions: MentionType[];
  content: string;
  context: UserMessageContext;
};

export function isUserMessageType(
  arg: UserMessageType | AgentMessageType
): arg is UserMessageType {
  return arg.type === "user_message";
}

/**
 * Agent messages
 */

export type UserFeedbackType = {
  user: UserType;
  value: "positive" | "negative" | null;
  comment: string | null;
};

export type AgentActionType = RetrievalActionType;
export type AgentMessageStatus = "created" | "succeeded" | "failed";

/**
 * Both `action` and `message` are optional (we could have a no-op agent basically).
 *
 * Since `action` and `message` are bundled together, it means that we will only be able to retry
 * them together in case of error of either. We store an error only here whether it's an error
 * coming from the action or from the message generation.
 */
export type AgentMessageType = {
  id: ModelId;
  type: "agent_message";
  sId: string;
  visibility: MessageVisibility;
  version: number;
  parentMessageId: string | null;

  configuration: AgentConfigurationType;
  status: AgentMessageStatus;
  action: AgentActionType | null;
  content: string | null;
  feedbacks: UserFeedbackType[];
  error: {
    code: string;
    message: string;
  } | null;
};

export function isAgentMessageType(
  arg: UserMessageType | AgentMessageType
): arg is AgentMessageType {
  return arg.type === "agent_message";
}

/**
 * Conversations
 */

export type ConversationVisibility = "unlisted" | "workspace";

/**
 * content [][] structure is intended to allow retries (of agent messages) or edits (of user
 * messages).
 */
export type ConversationType = {
  id: ModelId;
  created: number;
  sId: string;
  owner: WorkspaceType;
  title: string | null;
  visibility: ConversationVisibility;
  content: (UserMessageType[] | AgentMessageType[])[];
};

/**
 * A lighter version of Conversation without the content (for menu display).
 */
export type ConversationWithoutContentType = {
  id: ModelId;
  created: number;
  sId: string;
  owner: WorkspaceType;
  title: string | null;
};

export type ParticipantActionType = "posted" | "reacted" | "subscribed";
