import { Request, Response } from "express";
import { RESPONSE_CODE, type IReqObject } from "../types/index.js";
import ZodValidation from "../lib/zodValidation.js";
import {
  createConversationSchema,
  processConversationSchema,
} from "../lib/schema_validation.js";
import type { CreateConversationPayload } from "../types/conversation.type.js";
import ConversationService from "../services/conversation.service.js";
import sendResponse from "../lib/sendResponse.js";
import prisma from "../prisma/prisma.js";
import HttpException from "../lib/exception.js";
import AIService from "../services/AI.service.js";
import { chatbotTemplatePrompt } from "../data/agent/prompt.js";
import GeminiService from "../services/gemini.service.js";
import logger from "../config/logger.js";
import shortUUID from "short-uuid";

export default class ConversationController {
  private conversationService = new ConversationService();
  private aiService = new AIService();
  private geminiService = new GeminiService();
  constructor() {}

  public getConversationById(req: Request & IReqObject, res: Response) {
    // get conversation by id
  }

  public async getAllConversationsByWidgetAccount(
    req: Request & IReqObject,
    res: Response
  ) {
    const user = req.user;
    const conversations = await prisma.conversations.findMany({
      where: {
        conversationAccountId: user.id,
      },
    });

    console.log(user);

    const convWithMessages = [];
    for (const nc of conversations) {
      const lastMsg = await prisma.chatMessages.findFirst({
        where: {
          convId: nc.id,
          // senderId: user.id,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      const sender =
        lastMsg?.role === "admin"
          ? await prisma.users.findFirst({
              where: {
                uId: lastMsg.senderId,
              },
              select: {
                id: true,
                fullname: true,
                avatar: true,
                email: true,
              },
            })
          : lastMsg?.role === "customer"
            ? await prisma.chatWidgetAccount.findFirst({
                where: {
                  id: lastMsg.senderId,
                },
                select: {
                  id: true,
                  name: true,
                },
              })
            : await prisma.agents.findFirst({
                where: {
                  id: lastMsg?.agentId,
                },
                select: {
                  id: true,
                  name: true,
                },
              });

      if (lastMsg) {
        convWithMessages.push({
          ...nc,
          lastMsg: {
            message: lastMsg.content,
            date: lastMsg.created_at,
            sender: {
              ...sender,
              role: lastMsg.role,
            },
          },
        });
      }
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversations retrieved successfully",
      200,
      convWithMessages
    );
  }

  // Admin / Owner Specific
  public async getAllConversationsAdmin(
    req: Request & IReqObject,
    res: Response
  ) {
    const user = req.user;

    const conversations = await prisma.conversations.findMany();
    const adminSpecificAgents = await prisma.agents.findMany({
      where: {
        userId: user.id,
      },
    });

    const newConversations = [];
    for (const ag of adminSpecificAgents) {
      const conv = conversations.filter((c) => c.agentId === ag.id);
      newConversations.push(...conv);
    }

    const convWithMessages = [];
    for (const nc of newConversations) {
      const lastMsg = await prisma.chatMessages.findFirst({
        where: {
          convId: nc.id,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      const sender =
        lastMsg?.role === "admin"
          ? await prisma.users.findFirst({
              where: {
                uId: lastMsg.senderId,
              },
              select: {
                id: true,
                fullname: true,
                avatar: true,
                email: true,
              },
            })
          : lastMsg?.role === "customer"
            ? await prisma.chatWidgetAccount.findFirst({
                where: {
                  id: lastMsg.senderId,
                },
                select: {
                  id: true,
                  name: true,
                },
              })
            : await prisma.agents.findFirst({
                where: {
                  id: lastMsg?.agentId,
                },
                select: {
                  id: true,
                  name: true,
                },
              });

      if (lastMsg) {
        convWithMessages.push({
          ...nc,
          lastMsg: {
            message: lastMsg.content,
            date: lastMsg.created_at,
            sender: {
              ...sender,
              role: lastMsg.role,
            },
          },
        });
      }
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversations retrieved successfully",
      200,
      convWithMessages
    );
  }

  // get all chat messages in a conversation
  public async getChatMessagesAdmin(req: Request & IReqObject, res: Response) {
    const user = req.user;
    const conversation_id = req.params.conversation_id;
    const conversation = await prisma.conversations.findFirst({
      where: {
        id: conversation_id,
      },
    });

    if (!conversation) {
      logger.error(`[Conversation]: ${conversation_id} not found.`);
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Conversation not found",
        404
      );
    }

    const adminSpecificAgents = await prisma.agents.findMany({
      where: {
        userId: user.id,
      },
    });

    if (!adminSpecificAgents.map((a) => a.id).includes(conversation.agentId)) {
      logger.error(
        `[Conversation]: ${conversation_id} not found or unauthorized to view.`
      );
      throw new HttpException(
        RESPONSE_CODE.FORBIDDEN,
        "Unauthorized to view this conversation.",
        403
      );
    }

    const messages = [];
    const allMessages = await prisma.chatMessages.findMany({
      where: {
        convId: conversation.id,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    for (const msg of allMessages) {
      const sender =
        msg?.role === "admin"
          ? await prisma.users.findFirst({
              where: {
                uId: msg.senderId,
              },
              select: {
                id: true,
                fullname: true,
                avatar: true,
                email: true,
              },
            })
          : msg?.role === "customer"
            ? await prisma.chatWidgetAccount.findFirst({
                where: {
                  id: msg.senderId,
                },
                select: {
                  id: true,
                  name: true,
                },
              })
            : await prisma.agents.findFirst({
                where: {
                  id: msg?.agentId,
                },
                select: {
                  id: true,
                  name: true,
                },
              });
      messages.push({
        message: msg.content,
        date: msg.created_at,
        sender: {
          ...sender,
          role: msg.role,
        },
      });
    }

    const escalationPeriods =
      await prisma.conversationEscalationPeriod.findMany({
        where: {
          conv_id: conversation.id,
        },
      });

    messages.push(
      ...escalationPeriods.map((e) => {
        return {
          last_message_index: e.last_msg_index,
          is_escalated: e.is_escalated,
          start_date: e.start_date,
        };
      })
    );

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Messages retrieved successfully",
      200,
      messages
    );
  }

  // Admin / Owner Specific
  public async getConversationsByAgent(
    req: Request & IReqObject,
    res: Response
  ) {}

  // start a new conversation
  public async createConversation(req: Request & IReqObject, res: Response) {
    const user = req.user;
    const payload = req.body as CreateConversationPayload;

    await ZodValidation(createConversationSchema, payload, req.serverUrl);

    // check if conversation account exists
    const chatWidgetAccount = await prisma.chatWidgetAccount.findFirst({
      where: {
        id: user.id,
      },
    });

    if (!chatWidgetAccount) {
      throw new HttpException(
        RESPONSE_CODE.FORBIDDEN,
        "Account doesn't exist",
        403
      );
    }

    // check if agent exists
    const agent = await prisma.agents.findFirst({
      where: {
        id: payload.agent_id,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    if (agent.type !== "CHATBOT") {
      throw new HttpException(
        RESPONSE_CODE.BAD_REQUEST,
        "Agent type not supported",
        400
      );
    }

    // create conversation
    const conversation = await this.conversationService.createConversation({
      userId: user.id,
      agent_id: payload.agent_id,
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversation created successfully",
      201,
      {
        id: conversation.id,
        agent_id: conversation.agentId,
      }
    );
  }

  // handle conversation between customer -> agent -> admin
  public async processConversation(req: Request & IReqObject, res: Response) {
    const user = req.user;
    const conversation_id = req.params.conversation_id;
    const payload = req.body as { query: string; response: string };

    await ZodValidation(processConversationSchema, payload, req.serverUrl);

    const conversation = await prisma.conversations.findFirst({
      where: {
        id: conversation_id,
      },
    });

    if (!conversation) {
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Conversation not found",
        404
      );
    }

    const userAccount = await prisma.users.findFirst({
      where: {
        uId: user.id,
      },
    });

    const chatwidgetAccount = await prisma.chatWidgetAccount.findFirst({
      where: {
        id: user.id,
      },
    });

    if (chatwidgetAccount && !userAccount) {
      // agent -> customer  | customer -> agent
      return await this.manageCustomerAgentInteraction(req, res, {
        query: payload.query,
        conv_id: conversation_id,
        userId: user.id,
      });
    }
    if (userAccount && !chatwidgetAccount) {
      // customer -> admin | admin -> customer
      return await this.manageAdminCustomerInteraction(req, res, {
        response: payload.response,
        conv_id: conversation_id,
        userId: user.id,
      });
    }
  }

  // CUSTOMER -> AGENT | AGENT -> CUSTOMER
  public async manageCustomerAgentInteraction(
    req: Request & IReqObject,
    res: Response,
    data: { query: string; conv_id: string; userId: string }
  ) {
    const conversation = await prisma.conversations.findFirst({
      where: {
        id: data.conv_id,
      },
      include: {
        agents: {
          select: {
            activated: true,
            id: true,
            type: true,
            userId: true,
            name: true,
          },
        },
      },
    });

    const agent = conversation.agents;

    // check if agent is activated
    if (!agent.activated) {
      logger.error(`[Agent]: ${agent.name} is not activated.`);
      throw new HttpException(
        RESPONSE_CODE.BAD_REQUEST,
        `${agent.name} is currently unavailable`,
        403
      );
    }

    if (!data.query || data.query.length === 0) {
      throw new HttpException(RESPONSE_CODE.BAD_REQUEST, "Query is empty", 400);
    }

    // store user query
    await this.storeChatMessage({
      conv_id: data.conv_id,
      role: "customer",
      content: data.query,
      agent_id: agent.id,
      sender_id: data.userId,
    });

    // check if conversation has been escalated to admin
    const lastEscalation = await prisma.conversationEscalationPeriod.findFirst({
      where: {
        conv_id: data.conv_id,
      },
      orderBy: {
        start_date: "desc",
      },
    });

    if (lastEscalation && lastEscalation?.is_escalated) {
      logger.info(
        `[Conversation]: ${data.conv_id} has been escalated to admin`
      );
      throw new HttpException(
        RESPONSE_CODE.CONVERSATION_ESCALATED,
        "Conversation escalated to admin",
        403
      );
    }

    const knowledgebase = await prisma.knowledgeBase.findMany({
      where: {
        userId: agent.userId,
      },
      include: {
        linked_knowledge_base: {
          select: {
            kb_id: true,
            agentId: true,
          },
        },
      },
    });

    const data_source_ids = [];

    for (const kb of knowledgebase) {
      const linked_kb = kb.linked_knowledge_base.find(
        (d) => d.agentId === agent.id
      );
      data_source_ids.push(linked_kb.kb_id);
    }

    const similarities = await this.aiService.vectorSimilaritySearch({
      user_input: data.query,
      data_source_ids,
      agent_id: agent.id,
    });

    const closestMatch = similarities
      .slice(0, 2)
      .map((d) => d.content)
      .join("\n");

    let chatHistoryTxt = "";
    const history = await this.getChatHistory({
      conv_id: data.conv_id,
    });

    history.slice(-5).forEach((h) => {
      chatHistoryTxt += `[${h.role}]: ${h.message}\n`;
    });

    const systemInstruction = chatbotTemplatePrompt({
      agentName: agent.name,
      context: closestMatch.trim(),
      history: chatHistoryTxt,
      query: data.query,
    });

    const aiResp = await this.geminiService.callAI({
      instruction: systemInstruction,
      user_prompt: data.query,
    });

    const aiMsg = aiResp.data;

    // agent
    await this.storeChatMessage({
      conv_id: data.conv_id,
      role: "agent",
      content: aiMsg,
      agent_id: agent.id,
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversation processed successfully",
      200,
      {
        user_query: data.query,
        response: aiMsg,
      }
    );
  }

  // CUSTOMER -> ADMIN | ADMIN -> CUSTOMER
  public async manageAdminCustomerInteraction(
    req: Request & IReqObject,
    res: Response,
    data: { response: string; conv_id: string; userId: string }
  ) {
    if (!data.response || data.response.length === 0) {
      throw new HttpException(
        RESPONSE_CODE.BAD_REQUEST,
        "Response is empty",
        400
      );
    }

    const convEscalated = await prisma.conversationEscalationPeriod.findFirst({
      where: {
        conv_id: data.conv_id,
      },
    });

    if (!convEscalated || !convEscalated.is_escalated) {
      logger.error(
        `[Conversation | Admin]: ${data.conv_id} has not been escalated to admin`
      );
      throw new HttpException(
        RESPONSE_CODE.CONVERSATION_NOT_ESCALATED,
        "Conversation not escalated to admin",
        403
      );
    }

    const conversation = await prisma.conversations.findFirst({
      where: {
        id: data.conv_id,
      },
      include: {
        agents: {
          select: {
            id: true,
          },
        },
      },
    });

    const agent = conversation.agents;

    // store admin response
    await this.storeChatMessage({
      conv_id: data.conv_id,
      role: "admin",
      content: data.response,
      agent_id: agent.id,
      sender_id: data.userId,
    });

    // send response to customer
    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversation processed successfully",
      200,
      {
        response: data.response,
      }
    );
  }

  public async escalateConversation(req: Request & IReqObject, res: Response) {
    const user = req.user;
    const conversation_id = req.params.conversation_id;

    const conversation = await prisma.conversations.findFirst({
      where: {
        id: conversation_id,
      },
    });

    if (!conversation) {
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Conversation not found",
        404
      );
    }

    // check if conversation has been escalated
    const lastEscalation = await prisma.conversationEscalationPeriod.findFirst({
      where: {
        conv_id: conversation_id,
      },
      orderBy: {
        start_date: "desc",
      },
    });

    const allMsg = await prisma.chatMessages.findMany({
      where: {
        convId: conversation_id,
      },
    });

    const last_msg_index = allMsg.map((d) => d.id).length - 1;

    if (
      last_msg_index === lastEscalation?.last_msg_index ||
      lastEscalation?.is_escalated
    ) {
      logger.info("[Conversation]: Conversation de-escalated");
      // update
      await prisma.conversationEscalationPeriod.update({
        where: {
          id: lastEscalation.id,
        },
        data: {
          is_escalated: !lastEscalation.is_escalated,
          last_msg_index,
        },
      });
    } else {
      logger.info("[Conversation]: Escalating conversation");
      // create
      await prisma.conversationEscalationPeriod.create({
        data: {
          id: shortUUID.generate(),
          last_msg_index,
          agent_id: conversation.agentId,
          is_escalated: true,
          start_date: new Date(),
          conversations: {
            connect: {
              id: conversation_id,
            },
          },
        },
      });
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Conversation escalated",
      200
    );
  }

  private async storeChatMessage(props: {
    conv_id: string;
    role: "agent" | "admin" | "customer";
    content: string;
    sender_id?: string | null;
    agent_id?: string | null;
  }) {
    const message = await prisma.chatMessages.create({
      data: {
        convId: props.conv_id,
        role: props.role,
        content: props.content ?? "",
        senderId: props.sender_id ?? null,
        agentId: props.agent_id,
      },
    });

    return message;
  }

  private async getChatHistory(props: { conv_id: string }) {
    const conversation = await prisma.conversations.findFirst({
      where: {
        id: props.conv_id,
      },
      include: {
        chat_messages: {
          orderBy: {
            created_at: "asc",
          },
        },
      },
    });

    return conversation.chat_messages.map((d) => {
      return {
        role: d.role,
        message: d.content,
      };
    });
  }
}

// create conversation account (mean't for users interracting via chatbot widget)
