import {
  cloneBaseConfig,
  DustProdActionRegistry,
} from "@app/lib/actions/registry";
import { runAction } from "@app/lib/actions/server";
import {
  AgentActionEvent,
  AgentActionSuccessEvent,
  AgentErrorEvent,
  AgentGenerationSuccessEvent,
  AgentMessageSuccessEvent,
  runAgent,
} from "@app/lib/api/assistant/agent";
import { getAgentConfiguration } from "@app/lib/api/assistant/configuration";
import {
  GenerationTokensEvent,
  renderConversationForModel,
} from "@app/lib/api/assistant/generation";
import { Authenticator } from "@app/lib/auth";
import { front_sequelize } from "@app/lib/databases";
import {
  AgentMessage,
  Conversation,
  ConversationParticipant,
  Mention,
  Message,
  User,
  UserMessage,
} from "@app/lib/models";
import { Err, Ok, Result } from "@app/lib/result";
import { generateModelSId } from "@app/lib/utils";
import logger from "@app/logger/logger";
import {
  AgentMessageType,
  ConversationType,
  ConversationVisibility,
  ConversationWithoutContentType,
  isAgentMention,
  isAgentMessageType,
  isUserMention,
  isUserMessageType,
  MentionType,
  UserMessageContext,
  UserMessageType,
} from "@app/types/assistant/conversation";

import { renderRetrievalActionByModelId } from "./actions/retrieval";

/**
 * Conversation Creation, update and deletion
 */

export async function createConversation(
  auth: Authenticator,
  {
    title,
    visibility,
  }: {
    title: string | null;
    visibility: ConversationVisibility;
  }
): Promise<ConversationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }

  const conversation = await Conversation.create({
    sId: generateModelSId(),
    workspaceId: owner.id,
    title: title,
    visibility: visibility,
  });

  return {
    id: conversation.id,
    owner,
    created: conversation.createdAt.getTime(),
    sId: conversation.sId,
    title: conversation.title,
    visibility: conversation.visibility,
    content: [],
  };
}

export async function updateConversation(
  auth: Authenticator,
  conversationId: string,
  {
    title,
    visibility,
  }: {
    title: string | null;
    visibility: ConversationVisibility;
  }
): Promise<ConversationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }

  const conversation = await Conversation.findOne({
    where: {
      sId: conversationId,
      workspaceId: auth.workspace()?.id,
    },
  });

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  await conversation.update({
    title: title,
    visibility: visibility,
  });

  const c = await getConversation(auth, conversationId);

  if (!c) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  return c;
}

export async function deleteConversation(
  auth: Authenticator,
  conversationId: string
): Promise<void> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }

  const conversation = await Conversation.findOne({
    where: {
      sId: conversationId,
      workspaceId: auth.workspace()?.id,
    },
  });

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  await conversation.destroy();
}

/**
 * Conversation Rendering
 */

async function renderUserMessage(
  message: Message,
  userMessage: UserMessage
): Promise<UserMessageType> {
  const [mentions, user] = await Promise.all([
    Mention.findAll({
      where: {
        messageId: message.id,
      },
      include: [
        {
          model: User,
          as: "user",
          required: false,
        },
      ],
    }),
    (async () => {
      if (userMessage.userId) {
        return await User.findOne({
          where: {
            id: userMessage.userId,
          },
        });
      }
      return null;
    })(),
  ]);

  return {
    id: message.id,
    sId: message.sId,
    type: "user_message",
    visibility: message.visibility,
    version: message.version,
    user: user
      ? {
          id: user.id,
          provider: user.provider,
          providerId: user.providerId,
          username: user.username,
          email: user.email,
          name: user.name,
          image: null,
          workspaces: [],
          isDustSuperUser: false,
        }
      : null,
    mentions: mentions.map((m) => {
      if (m.agentConfigurationId) {
        return {
          configurationId: m.agentConfigurationId,
        };
      }
      if (m.user) {
        return {
          provider: m.user.provider,
          providerId: m.user.providerId,
        };
      }
      throw new Error("Unreachable: mention must be either agent or user");
    }),
    content: userMessage.content,
    context: {
      username: userMessage.userContextUsername,
      timezone: userMessage.userContextTimezone,
      fullName: userMessage.userContextFullName,
      email: userMessage.userContextEmail,
      profilePictureUrl: userMessage.userContextProfilePictureUrl,
    },
  };
}

async function renderAgentMessage(
  auth: Authenticator,
  {
    message,
    agentMessage,
    messages,
  }: { message: Message; agentMessage: AgentMessage; messages: Message[] }
): Promise<AgentMessageType> {
  const [agentConfiguration, agentRetrievalAction] = await Promise.all([
    getAgentConfiguration(auth, agentMessage.agentConfigurationId),
    (async () => {
      if (agentMessage.agentRetrievalActionId) {
        return await renderRetrievalActionByModelId(
          agentMessage.agentRetrievalActionId
        );
      }
      return null;
    })(),
  ]);

  if (!agentConfiguration) {
    throw new Error(
      `Configuration ${agentMessage.agentConfigurationId} not found`
    );
  }

  let error: {
    code: string;
    message: string;
  } | null = null;
  if (agentMessage.errorCode !== null && agentMessage.errorMessage !== null) {
    error = {
      code: agentMessage.errorCode,
      message: agentMessage.errorMessage,
    };
  }

  return {
    id: message.id,
    sId: message.sId,
    type: "agent_message",
    visibility: message.visibility,
    version: message.version,
    parentMessageId:
      messages.find((m) => m.id === message.parentId)?.sId ?? null,
    status: agentMessage.status,
    action: agentRetrievalAction,
    content: agentMessage.content,
    feedbacks: [],
    error,
    configuration: agentConfiguration,
  };
}

export async function getUserConversations(
  auth: Authenticator
): Promise<ConversationWithoutContentType[]> {
  const owner = auth.workspace();
  const user = auth.user();
  if (!owner) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }
  if (!user) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }

  const participations = await ConversationParticipant.findAll({
    where: {
      userId: user.id,
      action: "posted",
    },
    include: [
      {
        model: Conversation,
        as: "conversation",
        required: true,
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  const conversations = participations.reduce<ConversationWithoutContentType[]>(
    (acc, p) => {
      if (!p.conversation) {
        logger.error("Participation without conversation");
        return acc;
      }

      const conversation = {
        id: p.conversationId,
        created: p.conversation.createdAt.getTime(),
        sId: p.conversation.sId,
        owner,
        title: p.conversation.title,
      };

      return [...acc, conversation];
    },
    []
  );

  return conversations;
}

export async function getConversation(
  auth: Authenticator,
  conversationId: string
): Promise<ConversationType | null> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Unexpected `auth` without `workspace`.");
  }

  const conversation = await Conversation.findOne({
    where: {
      sId: conversationId,
      workspaceId: owner.id,
    },
  });

  if (!conversation) {
    return null;
  }

  const messages = await Message.findAll({
    where: {
      conversationId: conversation.id,
    },
    order: [
      ["rank", "ASC"],
      ["version", "ASC"],
    ],
    include: [
      {
        model: UserMessage,
        as: "userMessage",
        required: false,
      },
      {
        model: AgentMessage,
        as: "agentMessage",
        required: false,
      },
    ],
  });

  const render = await Promise.all(
    messages.map((message) => {
      return (async () => {
        if (message.userMessage) {
          const m = await renderUserMessage(message, message.userMessage);
          return { m, rank: message.rank, version: message.version };
        }
        if (message.agentMessage) {
          const m = await renderAgentMessage(auth, {
            message,
            agentMessage: message.agentMessage,
            messages,
          });
          return { m, rank: message.rank, version: message.version };
        }
        throw new Error("Unreachable: message must be either user or agent");
      })();
    })
  );
  render.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.version - b.version;
  });

  // We need to escape the type system here to create content. We pre-create an array that will hold
  // the versions of each User/Assistant message. The lenght of that array is by definition the
  // maximal rank of the conversation messages we just retrieved. In the case there is no message
  // the rank is -1 and the array length is 0 as expected.
  const content: any[] = Array.from(
    { length: messages.reduce((acc, m) => Math.max(acc, m.rank), -1) + 1 },
    () => []
  );

  for (const { m, rank } of render) {
    content[rank] = [...content[rank], m];
  }

  return {
    id: conversation.id,
    created: conversation.createdAt.getTime(),
    sId: conversation.sId,
    owner,
    title: conversation.title,
    visibility: conversation.visibility,
    content,
  };
}

/**
 * Title generation
 */

export async function generateConversationTitle(
  auth: Authenticator,
  conversation: ConversationType
): Promise<Result<string, Error>> {
  const model = {
    providerId: "openai",
    modelId: "gpt-3.5-turbo-16k",
  };
  const allowedTokenCount = 12288; // for 16k model.

  // Turn the conversation into a digest that can be presented to the model.
  const modelConversationRes = await renderConversationForModel({
    conversation,
    model,
    allowedTokenCount,
  });

  if (modelConversationRes.isErr()) {
    return modelConversationRes;
  }

  const config = cloneBaseConfig(
    DustProdActionRegistry["assistant-v2-title-generator"].config
  );
  config.MODEL.provider_id = model.providerId;
  config.MODEL.model_id = model.modelId;

  const res = await runAction(auth, "assistant-v2-title-generator", config, [
    {
      conversation: modelConversationRes.value,
    },
  ]);

  if (res.isErr()) {
    return new Err(
      new Error(`Error generating conversation title: ${res.error}`)
    );
  }

  const run = res.value;

  let title: string | null = null;
  for (const t of run.traces) {
    if (t[1][0][0].error) {
      return new Err(
        new Error(`Error generating conversation title: ${t[1][0][0].error}`)
      );
    }
    if (t[0][1] === "OUTPUT") {
      const v = t[1][0][0].value as any;
      if (v.conversation_title) {
        title = v.conversation_title;
      }
    }
  }

  if (title === null) {
    return new Err(
      new Error(`Error generating conversation title: malformed output`)
    );
  }

  return new Ok(title);
}

/**
 * Conversation API
 */

// Event sent when the user message is created.
export type UserMessageNewEvent = {
  type: "user_message_new";
  created: number;
  messageId: string;
  message: UserMessageType;
};

// Event sent when the user message is created.
export type UserMessageErrorEvent = {
  type: "user_message_error";
  created: number;
  error: {
    code: string;
    message: string;
  };
};

// Event sent when a new message is created (empty) and the agent is about to be executed.
export type AgentMessageNewEvent = {
  type: "agent_message_new";
  created: number;
  configurationId: string;
  messageId: string;
  message: AgentMessageType;
};

// Event sent when the conversation title is updated.
export type ConversationTitleEvent = {
  type: "conversation_title";
  created: number;
  title: string;
};

// This method is in charge of creating a new user message in database, running the necessary agents
// in response and updating accordingly the conversation. AgentMentions must point to valid agent
// configurations from the same workspace or whose scope is global.
export async function* postUserMessage(
  auth: Authenticator,
  {
    conversation,
    content,
    mentions,
    context,
  }: {
    conversation: ConversationType;
    content: string;
    mentions: MentionType[];
    context: UserMessageContext;
  }
): AsyncGenerator<
  | UserMessageErrorEvent
  | UserMessageNewEvent
  | AgentMessageNewEvent
  | AgentErrorEvent
  | AgentActionEvent
  | AgentActionSuccessEvent
  | GenerationTokensEvent
  | AgentGenerationSuccessEvent
  | AgentMessageSuccessEvent
  | ConversationTitleEvent,
  void
> {
  const user = auth.user();
  const owner = auth.workspace();

  if (!owner || owner.id !== conversation.owner.id) {
    yield {
      type: "user_message_error",
      created: Date.now(),
      error: {
        code: "conversation_not_found",
        message: "The conversation does not exist.",
      },
    };
    return;
  }

  // In one big transaction creante all Message, UserMessage, AgentMessage and Mention rows.
  const { userMessage, agentMessages, agentMessageRows } =
    await front_sequelize.transaction(async (t) => {
      let nextMessageRank =
        ((await Message.max<number | null, Message>("rank", {
          where: {
            conversationId: conversation.id,
          },
          transaction: t,
        })) ?? -1) + 1;

      async function createMessageAndUserMessage() {
        return await Message.create(
          {
            sId: generateModelSId(),
            rank: nextMessageRank++,
            conversationId: conversation.id,
            parentId: null,
            userMessageId: (
              await UserMessage.create(
                {
                  content,
                  userContextUsername: context.username,
                  userContextTimezone: context.timezone,
                  userContextFullName: context.fullName,
                  userContextEmail: context.email,
                  userContextProfilePictureUrl: context.profilePictureUrl,
                  userId: user ? user.id : null,
                },
                { transaction: t }
              )
            ).id,
          },
          {
            transaction: t,
          }
        );
      }
      async function createOrUpdateParticipation() {
        if (user) {
          const participant = await ConversationParticipant.findOne({
            where: {
              conversationId: conversation.id,
              userId: user.id,
            },
            transaction: t,
          });
          if (participant) {
            return await participant.update(
              {
                action: "posted",
              },
              { transaction: t }
            );
          } else {
            return await ConversationParticipant.create(
              {
                conversationId: conversation.id,
                userId: user.id,
                action: "posted",
              },
              { transaction: t }
            );
          }
        }
      }
      const result = await Promise.all([
        createMessageAndUserMessage(),
        createOrUpdateParticipation(),
      ]);

      const m = result[0];
      const userMessage: UserMessageType = {
        id: m.id,
        sId: m.sId,
        type: "user_message",
        visibility: "visible",
        version: 0,
        user: user,
        mentions: mentions,
        content,
        context: context,
      };

      const results: ({ row: AgentMessage; m: AgentMessageType } | null)[] =
        await Promise.all(
          mentions.filter(isAgentMention).map((mention) => {
            // For each assistant/agent mention, create an "empty" agent message.
            return (async () => {
              // `getAgentConfiguration` checks that we're only pulling a configuration from the
              // same workspace or a global one.
              const configuration = await getAgentConfiguration(
                auth,
                mention.configurationId
              );
              if (!configuration) {
                return null;
              }

              await Mention.create(
                {
                  messageId: m.id,
                  agentConfigurationId: configuration.sId,
                },
                { transaction: t }
              );

              const agentMessageRow = await AgentMessage.create(
                {
                  status: "created",
                  agentConfigurationId: configuration.sId,
                  agentConfigurationVersion: configuration.version,
                },
                { transaction: t }
              );
              const messageRow = await Message.create(
                {
                  sId: generateModelSId(),
                  rank: nextMessageRank++,
                  conversationId: conversation.id,
                  parentId: userMessage.id,
                  agentMessageId: agentMessageRow.id,
                },
                {
                  transaction: t,
                }
              );

              return {
                row: agentMessageRow,
                m: {
                  id: messageRow.id,
                  sId: messageRow.sId,
                  type: "agent_message",
                  visibility: "visible",
                  version: 0,
                  parentMessageId: userMessage.sId,
                  status: "created",
                  action: null,
                  content: null,
                  feedbacks: [],
                  error: null,
                  configuration,
                },
              };
            })();
          })
        );

      await Promise.all(
        mentions.filter(isUserMention).map((mention) => {
          return (async () => {
            const user = await User.findOne({
              where: {
                provider: mention.provider,
                providerId: mention.providerId,
              },
            });

            if (user) {
              await Mention.create(
                {
                  messageId: m.id,
                  userId: user.id,
                },
                { transaction: t }
              );
            }
          })();
        })
      );

      const nonNullResults = results.filter((r) => r !== null) as {
        row: AgentMessage;
        m: AgentMessageType;
      }[];

      return {
        userMessage,
        agentMessages: nonNullResults.map(({ m }) => m),
        agentMessageRows: nonNullResults.map(({ row }) => row),
      };
    });

  if (agentMessageRows.length !== agentMessages.length) {
    throw new Error("Unreachable: agentMessageRows and agentMessages mismatch");
  }

  yield {
    type: "user_message_new",
    created: Date.now(),
    messageId: userMessage.sId,
    message: userMessage,
  };

  for (let i = 0; i < agentMessages.length; i++) {
    const agentMessage = agentMessages[i];

    yield {
      type: "agent_message_new",
      created: Date.now(),
      configurationId: agentMessage.configuration.sId,
      messageId: agentMessage.sId,
      message: agentMessage,
    };
  }

  const eventStreamGenerators = agentMessages.map((agentMessage, i) => {
    // We stitch the conversation to add the user message and only that agent message
    // so that it can be used to prompt the agent.
    const eventStream = runAgent(
      auth,
      agentMessage.configuration,
      {
        ...conversation,
        content: [...conversation.content, [userMessage], [agentMessage]],
      },
      userMessage,
      agentMessage
    );

    return streamRunAgentEvents(eventStream, agentMessageRows[i]);
  });

  const eventStreamsPromises = eventStreamGenerators.map((gen) => gen.next());
  while (eventStreamsPromises.length > 0) {
    const winner = await Promise.race(
      eventStreamsPromises.map(async (p, i) => {
        return { v: await p, offset: i };
      })
    );
    if (winner.v.done) {
      eventStreamGenerators.splice(winner.offset, 1);
      eventStreamsPromises.splice(winner.offset, 1);
    } else {
      eventStreamsPromises[winner.offset] =
        eventStreamGenerators[winner.offset].next();
      yield winner.v.value;
    }
  }

  // Generate a new title if the conversation does not have one already.
  if (conversation.title === null) {
    const titleRes = await generateConversationTitle(auth, {
      ...conversation,
      content: [
        ...conversation.content,
        [userMessage],
        ...agentMessages.map((m) => [m]),
      ],
    });
    if (titleRes.isErr()) {
      logger.error(
        {
          error: titleRes.error,
        },
        "Conversation title generation error"
      );
    } else {
      const title = titleRes.value;
      await Conversation.update(
        {
          title,
        },
        {
          where: {
            id: conversation.id,
          },
        }
      );

      yield {
        type: "conversation_title",
        created: Date.now(),
        title,
      };
    }
  }
}

/** This method creates a new user message version, and if there are new agent
 *  mentions, run them
 *  TODO: support editing with new agent mentions for any
 *  message (rather than just the last)
 */
export async function* editUserMessage(
  auth: Authenticator,
  {
    conversation,
    message,
    content,
    mentions,
  }: {
    conversation: ConversationType;
    message: UserMessageType;
    content: string;
    mentions: MentionType[];
  }
): AsyncGenerator<
  | UserMessageNewEvent
  | UserMessageErrorEvent
  | AgentMessageNewEvent
  | AgentErrorEvent
  | AgentActionEvent
  | AgentActionSuccessEvent
  | GenerationTokensEvent
  | AgentGenerationSuccessEvent
  | AgentMessageSuccessEvent,
  void
> {
  const user = auth.user();
  const owner = auth.workspace();

  if (!owner || owner.id !== conversation.owner.id) {
    yield {
      type: "user_message_error",
      created: Date.now(),
      error: {
        code: "conversation_not_found",
        message: "The conversation does not exist.",
      },
    };
    return;
  }
  if (auth.user()?.id !== message.user?.id) {
    yield {
      type: "user_message_error",
      created: Date.now(),
      error: {
        code: "not_allowed",
        message: "Only the author of the message can edit it",
      },
    };
    return;
  }
  if (message.mentions.filter((m) => isAgentMention(m)).length > 0) {
    yield {
      type: "user_message_error",
      created: Date.now(),
      error: {
        code: "not_allowed",
        message:
          "Editing a message that already has agent mentions is not yet supported",
      },
    };
    return;
  }

  if (
    !conversation.content[conversation.content.length - 1].some(
      (m) => m.sId === message.sId
    ) &&
    mentions.filter((m) => isAgentMention(m)).length > 0
  ) {
    yield {
      type: "user_message_error",
      created: Date.now(),
      error: {
        code: "not_allowed",
        message:
          "Adding agent mentions when editing is only supported for the last message of the conversation",
      },
    };
    return;
  }

  // In one big transaction creante all Message, UserMessage, AgentMessage and Mention rows.
  const { userMessage, agentMessages, agentMessageRows } =
    await front_sequelize.transaction(async (t) => {
      const messageRow = await Message.findOne({
        where: {
          sId: message.sId,
          conversationId: conversation.id,
        },
        include: [
          {
            model: UserMessage,
            as: "userMessage",
            required: true,
          },
        ],
      });
      if (!messageRow || !messageRow.userMessage) {
        throw new Error(
          "Unexpected: Message or UserMessage to edit not found in DB"
        );
      }
      const userMessageRow = messageRow.userMessage;
      // adding messageRow as param otherwise Ts doesn't get it can't be null
      async function createMessageAndUserMessage(messageRow: Message) {
        return await Message.create(
          {
            sId: generateModelSId(),
            rank: messageRow.rank,
            conversationId: conversation.id,
            parentId: messageRow.parentId,
            version: messageRow.version + 1,
            userMessageId: (
              await UserMessage.create(
                {
                  content,
                  userContextUsername: userMessageRow.userContextUsername,
                  userContextTimezone: userMessageRow.userContextTimezone,
                  userContextFullName: userMessageRow.userContextFullName,
                  userContextEmail: userMessageRow.userContextEmail,
                  userContextProfilePictureUrl:
                    userMessageRow.userContextProfilePictureUrl,
                  userId: userMessageRow.userId,
                },
                { transaction: t }
              )
            ).id,
          },
          {
            transaction: t,
          }
        );
      }
      async function createOrUpdateParticipation() {
        if (user) {
          const participant = await ConversationParticipant.findOne({
            where: {
              conversationId: conversation.id,
              userId: user.id,
            },
            transaction: t,
          });
          if (participant) {
            return await participant.update(
              {
                action: "posted",
              },
              { transaction: t }
            );
          } else {
            throw new Error(
              "Unreachable: edited message implies participation"
            );
          }
        }
      }
      const result = await Promise.all([
        createMessageAndUserMessage(messageRow),
        createOrUpdateParticipation(),
      ]);

      const m = result[0];
      const userMessage: UserMessageType = {
        id: m.id,
        sId: m.sId,
        type: "user_message",
        visibility: m.visibility,
        version: m.version,
        user: user,
        mentions,
        content,
        context: message.context,
      };

      // For now agent messages are appended at the end of conversation
      // it is fine since for now editing with new mentions is only supported
      // for the last user message
      let nextMessageRank =
        ((await Message.max<number | null, Message>("rank", {
          where: {
            conversationId: conversation.id,
          },
          transaction: t,
        })) ?? -1) + 1;
      const results: ({ row: AgentMessage; m: AgentMessageType } | null)[] =
        await Promise.all(
          mentions.filter(isAgentMention).map((mention) => {
            // For each assistant/agent mention, create an "empty" agent message.
            return (async () => {
              // `getAgentConfiguration` checks that we're only pulling a configuration from the
              // same workspace or a global one.
              const configuration = await getAgentConfiguration(
                auth,
                mention.configurationId
              );
              if (!configuration) {
                return null;
              }

              await Mention.create(
                {
                  messageId: m.id,
                  agentConfigurationId: configuration.sId,
                },
                { transaction: t }
              );

              const agentMessageRow = await AgentMessage.create(
                {
                  status: "created",
                  agentConfigurationId: configuration.sId,
                  agentConfigurationVersion: configuration.version,
                },
                { transaction: t }
              );
              const messageRow = await Message.create(
                {
                  sId: generateModelSId(),
                  rank: nextMessageRank++,
                  conversationId: conversation.id,
                  parentId: userMessage.id,
                  agentMessageId: agentMessageRow.id,
                },
                {
                  transaction: t,
                }
              );

              return {
                row: agentMessageRow,
                m: {
                  id: messageRow.id,
                  sId: messageRow.sId,
                  type: "agent_message",
                  visibility: "visible",
                  version: 0,
                  parentMessageId: userMessage.sId,
                  status: "created",
                  action: null,
                  content: null,
                  feedbacks: [],
                  error: null,
                  configuration,
                },
              };
            })();
          })
        );

      await Promise.all(
        mentions.filter(isUserMention).map((mention) => {
          return (async () => {
            const user = await User.findOne({
              where: {
                provider: mention.provider,
                providerId: mention.providerId,
              },
            });

            if (user) {
              await Mention.create(
                {
                  messageId: m.id,
                  userId: user.id,
                },
                { transaction: t }
              );
            }
          })();
        })
      );

      const nonNullResults = results.filter((r) => r !== null) as {
        row: AgentMessage;
        m: AgentMessageType;
      }[];
      return {
        userMessage,
        agentMessages: nonNullResults.map(({ m }) => m),
        agentMessageRows: nonNullResults.map(({ row }) => row),
      };
    });

  if (agentMessageRows.length !== agentMessages.length) {
    throw new Error("Unreachable: agentMessageRows and agentMessages mismatch");
  }

  yield {
    type: "user_message_new",
    created: Date.now(),
    messageId: userMessage.sId,
    message: userMessage,
  };

  for (let i = 0; i < agentMessages.length; i++) {
    const agentMessage = agentMessages[i];

    yield {
      type: "agent_message_new",
      created: Date.now(),
      configurationId: agentMessage.configuration.sId,
      messageId: agentMessage.sId,
      message: agentMessage,
    };
  }

  const eventStreamGenerators = agentMessages.map((agentMessage, i) => {
    // We stitch the conversation to add the user message and only that agent message
    // so that it can be used to prompt the agent.
    const eventStream = runAgent(
      auth,
      agentMessage.configuration,
      {
        ...conversation,
        content: [...conversation.content, [userMessage], [agentMessage]],
      },
      userMessage,
      agentMessage
    );

    return streamRunAgentEvents(eventStream, agentMessageRows[i]);
  });

  const eventStreamsPromises = eventStreamGenerators.map((gen) => gen.next());
  while (eventStreamsPromises.length > 0) {
    const winner = await Promise.race(
      eventStreamsPromises.map(async (p, i) => {
        return { v: await p, offset: i };
      })
    );
    if (winner.v.done) {
      eventStreamGenerators.splice(winner.offset, 1);
      eventStreamsPromises.splice(winner.offset, 1);
    } else {
      eventStreamsPromises[winner.offset] =
        eventStreamGenerators[winner.offset].next();
      yield winner.v.value;
    }
  }
}

// This method is in charge of re-running an agent interaction (generating a new
// AgentMessage as a result)
export async function* retryAgentMessage(
  auth: Authenticator,
  {
    conversation,
    message,
  }: {
    conversation: ConversationType;
    message: AgentMessageType;
  }
): AsyncGenerator<
  | AgentMessageNewEvent
  | AgentErrorEvent
  | AgentActionEvent
  | AgentActionSuccessEvent
  | GenerationTokensEvent
  | AgentGenerationSuccessEvent
  | AgentMessageSuccessEvent,
  void
> {
  const agentMessageResult: {
    agentMessage: AgentMessageType;
    agentMessageRow: AgentMessage;
  } | null = await front_sequelize.transaction(async (t) => {
    const messageRow = await Message.findOne({
      where: {
        conversationId: conversation.id,
        id: message.id,
      },
      include: [
        {
          model: AgentMessage,
          as: "agentMessage",
          required: true,
        },
      ],
      transaction: t,
    });

    if (!messageRow || !messageRow.agentMessage) {
      return null;
    }
    const agentMessageRow = await AgentMessage.create(
      {
        status: "created",
        agentConfigurationId: messageRow.agentMessage.agentConfigurationId,
        agentConfigurationVersion:
          messageRow.agentMessage.agentConfigurationVersion,
      },
      { transaction: t }
    );
    const m = await Message.create(
      {
        sId: generateModelSId(),
        rank: messageRow.rank,
        conversationId: conversation.id,
        parentId: messageRow.parentId,
        version: messageRow.version + 1,
        agentMessageId: agentMessageRow.id,
      },
      {
        transaction: t,
      }
    );
    const agentMessage: AgentMessageType = {
      id: m.id,
      sId: m.sId,
      type: "agent_message",
      visibility: m.visibility,
      version: m.version,
      parentMessageId: message.parentMessageId,
      status: "created",
      action: null,
      content: null,
      feedbacks: [],
      error: null,
      configuration: message.configuration,
    };
    return {
      agentMessage,
      agentMessageRow,
    };
  });

  if (!agentMessageResult) {
    yield {
      type: "agent_error",
      created: Date.now(),
      configurationId: message.configuration.sId,
      messageId: message.sId,
      error: {
        code: "message_not_found",
        message: "The message to retry was not found",
      },
    };
    return;
  }

  const { agentMessage, agentMessageRow } = agentMessageResult;

  yield {
    type: "agent_message_new",
    created: Date.now(),
    configurationId: agentMessage.configuration.sId,
    messageId: agentMessage.sId,
    message: agentMessage,
  };

  // We stitch the conversation to retry the agent message correctly: no other
  // messages than this agent's past its parent message.

  // First, find the array of the parent message in conversation.content.
  const parentMessageIndex = conversation.content.findIndex((messages) => {
    return messages.some((m) => m.sId === agentMessage.parentMessageId);
  });
  if (parentMessageIndex === -1) {
    throw new Error(
      `Parent message ${agentMessage.parentMessageId} not found in conversation`
    );
  }

  // Then, find this agentmessage's array in conversation.content and add the
  // new agent message to it.
  const agentMessageArray = conversation.content.find((messages) => {
    return messages.some((m) => m.sId === message.sId && isAgentMessageType(m));
  }) as AgentMessageType[];
  agentMessageArray.push(agentMessage);

  // Finally, stitch the conversation.
  const newContent = [
    ...conversation.content.slice(0, parentMessageIndex + 1),
    [...agentMessageArray, agentMessage],
  ];

  const userMessage =
    conversation.content[parentMessageIndex][
      conversation.content[parentMessageIndex].length - 1
    ];
  if (!isUserMessageType(userMessage)) {
    throw new Error("Unreachable: parent message must be a user message");
  }

  const eventStream = runAgent(
    auth,
    agentMessage.configuration,
    {
      ...conversation,
      content: newContent,
    },
    userMessage,
    agentMessage
  );

  yield* streamRunAgentEvents(eventStream, agentMessageRow);
}

async function* streamRunAgentEvents(
  eventStream: AsyncGenerator<
    | AgentErrorEvent
    | AgentActionEvent
    | AgentActionSuccessEvent
    | GenerationTokensEvent
    | AgentGenerationSuccessEvent
    | AgentMessageSuccessEvent,
    void
  >,
  agentMessageRow: AgentMessage
): AsyncGenerator<
  | AgentErrorEvent
  | AgentActionEvent
  | AgentActionSuccessEvent
  | GenerationTokensEvent
  | AgentGenerationSuccessEvent
  | AgentMessageSuccessEvent,
  void
> {
  for await (const event of eventStream) {
    switch (event.type) {
      case "agent_error":
        // Store error in database.
        await agentMessageRow.update({
          status: "failed",
          errorCode: event.error.code,
          errorMessage: event.error.message,
        });

        logger.error(
          {
            error: event.error,
          },
          "Agent error"
        );

        yield event;
        return;

      case "agent_action_success":
        // Store action in database.
        if (event.action.type === "retrieval_action") {
          await agentMessageRow.update({
            agentRetrievalActionId: event.action.id,
          });
        } else {
          throw new Error(
            `Action type ${event.action.type} agent_action_success handling not implemented`
          );
        }
        yield event;
        break;

      case "agent_generation_success":
        // Store message in database.
        await agentMessageRow.update({
          content: event.text,
        });
        yield event;
        break;

      case "agent_message_success":
        // Update status in database.
        await agentMessageRow.update({
          status: "succeeded",
        });
        yield event;
        break;

      // All other events that won't impact the database and are related to actions or tokens
      // generation.
      case "retrieval_params":
      case "generation_tokens":
        yield event;
        break;

      default:
        ((event: never) => {
          logger.error("Unknown `streamRunAgentEvents` event type", event);
        })(event);
        return;
    }
  }
}
