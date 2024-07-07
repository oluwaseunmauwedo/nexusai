import { Request, Response } from "express";
import BaseController from "./base.controller.js";
import sendResponse from "../lib/sendResponse.js";
import { RESPONSE_CODE, IReqObject } from "../types/index.js";
import { type AgentEnum, type AgentType } from "../types/index.js";
import ZodValidation from "../lib/zodValidation.js";
import {
  addIntegrationSchema,
  createAgentSchema,
  LinkPhoneNumberSchema,
  updateAgentSettingsSchema,
  VerifyOTPCode,
  verifyUsPhoneSchema,
} from "../lib/schema_validation.js";
import HttpException from "../lib/exception.js";
import { formatPhoneNumber, validateUsNumber } from "../lib/utils.js";
import OTPManager from "../lib/otp-manager.js";
import shortUUID from "short-uuid";
import prisma from "../prisma/prisma.js";
import { TwilioService } from "../services/twilio.service.js";
import redis from "../config/redis.js";
import rateLimit from "../middlewares/rateLimit.js";
import type { IntegrationType } from "@prisma/client";

interface ICreateAG {
  name: string;
  type: AgentType;
}

interface IUpdateAgentSettings {
  allow_handover: boolean;
  handover_condition: "emergency" | "help";
  security_code: string;
  agent_id: string;
}

export default class AgentController extends BaseController {
  otpManager = new OTPManager();
  twService = new TwilioService();
  constructor() {
    super();
  }

  async sendOTP(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const payload = req.body as { phone: string };

    await ZodValidation(verifyUsPhoneSchema, payload, req.serverUrl!);

    // check if phone number exists in forwarding number
    const fwdNum = await prisma.forwardingNumber.findFirst({
      where: {
        phone: payload.phone,
      },
    });

    if (fwdNum) {
      throw new HttpException(
        RESPONSE_CODE.DUPLICATE_ENTRY,
        "Phone number already in use",
        400
      );
    }

    // send OTP to phone number
    const otpSent = await this.otpManager.sendOTP(payload.phone, user.id);

    if (!otpSent) {
      throw new HttpException(
        RESPONSE_CODE.OTP_FAILED,
        "Failed to send OTP",
        400
      );
    }

    // rate limit send OTP route to 1 request per minute
    // the rateLimit middleware would have access to this key, only if
    // otp was sent successfully

    const ip = req.ip;
    const key = `rate-limit:${ip}`;

    await redis.set(key, user.id);
    await redis.expire(key, 60);

    sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "OTP sent successfully",
      200
    );
  }

  async getForwardedNumber(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const agentId = req.params["agent_id"];

    if (!agentId) {
      throw new HttpException(
        RESPONSE_CODE.BAD_REQUEST,
        "Agent ID is required",
        400
      );
    }

    const fwdNum = await prisma.forwardingNumber.findFirst({
      where: {
        agentId: agentId as string,
      },
      select: {
        phone: true,
        country: true,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Forwarded number retrieved successfully",
      200,
      fwdNum
    );
  }

  // make sure phone number starts with +1 for US.
  async verifyPhone(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const payload = req.body as { otp: string; agentId: string };

    await ZodValidation(VerifyOTPCode, payload, req.serverUrl!);

    // check if agent exists
    const agent = await prisma.agents.findFirst({
      where: {
        id: payload.agentId,
        userId: user.id,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    const otpcode = payload.otp;

    const otp = await this.otpManager.verifyOTP(user.id, otpcode);

    // save the number in forwarded numbers
    // check if phone number exists
    const forwardingNum = await prisma.forwardingNumber.findFirst({
      where: {
        agentId: payload.agentId,
      },
    });

    if (!forwardingNum) {
      await prisma.forwardingNumber.create({
        data: {
          phone: otp.phone,
          agentId: payload.agentId,
          country: "US",
        },
      });
    } else {
      // update
      await prisma.forwardingNumber.update({
        where: {
          id: forwardingNum.id,
        },
        data: {
          phone: otp.phone,
          agentId: payload.agentId,
          country: "US",
        },
      });
    }

    await redis.del(user.id);

    sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Phone number verified",
      200,
      otp
    );
  }

  async createAgent(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const payload = req.body as ICreateAG;
    await ZodValidation(createAgentSchema, payload, req.serverUrl!);

    const { name, type } = payload;

    // check if agent already exists
    const agentExists = await prisma.agents.findFirst({
      where: {
        name: name,
        userId: user.id,
      },
    });

    if (agentExists) {
      throw new HttpException(
        RESPONSE_CODE.DUPLICATE_ENTRY,
        "Agent already exists, please use a different name",
        400
      );
    }

    // prevent user from creating more than 1 ANTI_THEFT agent
    if (type === "ANTI_THEFT") {
      const antiTheftAgent = await prisma.agents.findFirst({
        where: {
          type: "ANTI_THEFT",
          userId: user.id,
        },
      });

      if (antiTheftAgent) {
        throw new HttpException(
          RESPONSE_CODE.DUPLICATE_ENTRY,
          "You can only have one Anti-theft agent",
          400
        );
      }
    }

    // create agent
    const agentId = shortUUID.generate();
    await prisma.agents.create({
      data: {
        id: agentId,
        name,
        type: type as AgentEnum,
        userId: user.id,
      },
    });

    // create default settings
    await prisma.agentSettings.create({
      data: {
        agentId,
        allow_handover: false,
        security_code: "",
        handover_condition: "emergency",
      },
    });

    sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Agent created successfully",
      200
    );
  }

  async activateAgent(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const agentId = req.params["id"];

    const agent = await prisma.agents.findFirst({
      where: {
        id: agentId as string,
        userId: user.id,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    if (agent.type === "SALES_ASSISTANT") {
      // check if user added at least one knowledge base
      const knowledgeBase = await prisma.knowledgeBase.findFirst({
        where: {
          userId: user.id,
        },
        select: {
          linked_knowledge_base: true,
        },
      });

      if (
        knowledgeBase?.linked_knowledge_base.length === 0 ||
        !knowledgeBase?.linked_knowledge_base
          .map((d) => d.agentId)
          .includes(agentId)
      ) {
        throw new HttpException(
          RESPONSE_CODE.BAD_REQUEST,
          "Link or Add at least one knowledge base",
          400
        );
      }

      const purchasedNumber = await prisma.purchasedPhoneNumbers.findFirst({
        where: {
          userId: user.id,
          agent_id: agentId as string,
        },
      });

      if (!purchasedNumber) {
        throw new HttpException(
          RESPONSE_CODE.BAD_REQUEST,
          "Buy a number to activate agent",
          400
        );
      }

      // activate agent
      await prisma.agents.update({
        where: {
          id: agentId as string,
        },
        data: {
          activated: true,
        },
      });

      return sendResponse.success(
        res,
        RESPONSE_CODE.SUCCESS,
        "Agent activated successfully",
        200
      );
    }
    if (agent.type === "ANTI_THEFT") {
      // check if user bought a number
      const purchasedNumber = await prisma.purchasedPhoneNumbers.findFirst({
        where: {
          userId: user.id,
          agent_id: agentId as string,
        },
      });

      if (!purchasedNumber) {
        throw new HttpException(
          RESPONSE_CODE.BAD_REQUEST,
          "Buy a number to activate agent",
          400
        );
      }

      // activate agent
      await prisma.agents.update({
        where: {
          id: agentId as string,
        },
        data: {
          activated: true,
        },
      });

      return sendResponse.success(
        res,
        RESPONSE_CODE.SUCCESS,
        "Agent activated successfully",
        200
      );
    }
    if (agent.type === "CHATBOT") {
      // check if user added at least one knowledge base
      const knowledgeBase = await prisma.knowledgeBase.findFirst({
        where: {
          userId: user.id,
        },
        select: {
          linked_knowledge_base: true,
        },
      });

      if (
        knowledgeBase?.linked_knowledge_base.length === 0 ||
        !knowledgeBase?.linked_knowledge_base
          .map((d) => d.agentId)
          .includes(agentId)
      ) {
        throw new HttpException(
          RESPONSE_CODE.BAD_REQUEST,
          "Link or Add at least one knowledge base",
          400
        );
      }

      // activate agent
      await prisma.agents.update({
        where: {
          id: agentId as string,
        },
        data: {
          activated: true,
        },
      });

      return sendResponse.success(
        res,
        RESPONSE_CODE.SUCCESS,
        "Agent activated successfully",
        200
      );
    }
  }

  async getAgents(req: Request & IReqObject, res: Response) {
    const user = req["user"];

    const agents = await prisma.agents.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        type: true,
        used_number: {
          select: {
            phone: true,
            dial_code: true,
            country: true,
            created_at: true,
          },
        },
        protected_numbers: {
          select: {
            id: true,
            phone: true,
            dial_code: true,
            country: true,
          },
        },
        agent_settings: true,
        created_at: true,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Agents retrieved successfully",
      200,
      agents
    );
  }

  async getAgent(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const agentId = req.params["id"];
    const agent = await prisma.agents.findFirst({
      where: {
        AND: {
          id: agentId as string,
          userId: user.id,
        },
      },
      select: {
        id: true,
        name: true,
        type: true,
        protected_numbers: {
          select: {
            id: true,
            phone: true,
            dial_code: true,
            country: true,
          },
        },
        created_at: true,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Agent retrieved successfully",
      200,
      agent
    );
  }

  async getAgentSettings(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const agentId = req.params["id"];
    const agentSettings = await prisma.agents.findFirst({
      where: {
        AND: {
          id: agentId as string,
          userId: user.id,
        },
      },
      select: {
        agent_settings: {
          select: {
            allow_handover: true,
            handover_condition: true,
            security_code: true,
          },
        },
        activated: true,
      },
    });

    if (!agentSettings) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    const settings = agentSettings.agent_settings;

    const formattedSettings = {
      allow_handover: settings?.allow_handover ?? false,
      handover_condition: settings?.handover_condition ?? null,
      security_code: settings?.security_code ?? null,
      activated: agentSettings.activated,
    };

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Agent settings retrieved successfully",
      200,
      formattedSettings
    );
  }

  async getUsedPhoneNumbers(req: Request & IReqObject, res: Response) {
    const user = req["user"];

    const usedNumbers = await prisma.usedPhoneNumbers.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        phone: true,
        country: true,
        dial_code: true,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Used phone numbers retrieved successfully",
      200,
      usedNumbers
    );
  }

  async getActiveAgentNumber(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const agentId = req.params["id"];

    const purchasedNumber = await prisma.purchasedPhoneNumbers.findFirst({
      where: {
        userId: user.id,
        agent_id: agentId,
        is_deleted: false,
      },
      select: {
        id: true,
        phone: true,
        country: true,
        sub_id: true,
      },
    });

    let subscription;
    if (purchasedNumber) {
      subscription = await prisma.subscriptions.findFirst({
        where: {
          subscription_id: purchasedNumber.sub_id,
          is_deleted: false,
        },
      });
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Active agent phone number retrieved successfully",
      200,
      purchasedNumber && subscription
        ? {
            phone: purchasedNumber?.phone,
            country: purchasedNumber?.country,
            subscription: {
              renews_at: subscription?.renews_at,
              ends_at: subscription?.ends_at,
              status: subscription?.status,
              variant: subscription.variant_name,
            },
          }
        : null
    );
  }

  async updateAgentSettings(req: Request & IReqObject, res: Response) {
    const user = req.user;
    const payload = req.body as IUpdateAgentSettings;

    await ZodValidation(updateAgentSettingsSchema, payload, req.serverUrl);

    // check if agent exists
    const agent = await prisma.agents.findFirst({
      where: {
        id: payload.agent_id,
        userId: user.id,
      },
      select: {
        agent_settings: {
          select: {
            allow_handover: true,
            handover_condition: true,
            security_code: true,
          },
        },
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    // check if handover condition is valid
    const validCondition = ["emergency", "help"];

    if (
      payload?.handover_condition === "emergency" &&
      !payload?.security_code
    ) {
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Security code is needed.",
        404
      );
    }

    if (
      payload?.handover_condition &&
      !validCondition.includes(payload?.handover_condition)
    ) {
      throw new HttpException(
        RESPONSE_CODE.INVALID_HANDOVER_CONDITION,
        "Handover condition is invalid",
        404
      );
    }

    // update
    const agentSettingsAvailable = await prisma.agentSettings.findFirst({
      where: {
        agentId: payload.agent_id,
      },
    });

    if (agentSettingsAvailable) {
      await prisma.agentSettings.update({
        where: {
          agentId: payload.agent_id,
        },
        data: {
          allow_handover:
            payload?.allow_handover ?? agent.agent_settings?.allow_handover,
          security_code:
            payload?.security_code ?? agent.agent_settings?.security_code,
          handover_condition:
            payload?.handover_condition ??
            agent.agent_settings?.handover_condition,
        },
      });
    } else {
      await prisma.agentSettings.create({
        data: {
          agentId: payload.agent_id,
          allow_handover:
            payload?.allow_handover ?? agent.agent_settings?.allow_handover,
          security_code:
            payload?.security_code ?? agent.agent_settings?.security_code,
          handover_condition:
            payload?.handover_condition ??
            agent.agent_settings?.handover_condition,
        },
      });
    }

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Agent settings updated successfully",
      200
    );
  }

  async getTwilioAvailableNumber(req: Request & IReqObject, res: Response) {
    const availableNumbers =
      await this.twService.getAvailableNumbersForPurchase("US");

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Available numbers retrieved successfully",
      200,
      availableNumbers
    );
  }

  // Link purchased phone number to agent
  async linkPhoneToAgent(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const payload = req.body as {
      purchased_phone_id: string;
      agentId: string;
    };

    await ZodValidation(LinkPhoneNumberSchema, payload, req.serverUrl!);

    // check if purchased phone number exists
    const phone = await prisma.purchasedPhoneNumbers.findFirst({
      where: {
        id: payload.purchased_phone_id,
        userId: user.id,
      },
    });

    if (!phone) {
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Phone number not found",
        404
      );
    }

    // check if agent exists
    const agent = await prisma.agents.findFirst({
      where: {
        id: payload.agentId,
        userId: user.id,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    // check if phone number has been linked to an agent
    const linkedPhone = await prisma.usedPhoneNumbers.findFirst({
      where: {
        phone: phone.phone,
      },
    });

    if (linkedPhone) {
      throw new HttpException(
        RESPONSE_CODE.DUPLICATE_ENTRY,
        "Phone number already linked to an agent",
        400
      );
    }

    // link phone number to agent
    // Add phone number to used phone numbers
    await prisma.usedPhoneNumbers.create({
      data: {
        phone: phone.phone,
        userId: user.id,
        agentId: agent.id,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Phone number linked to agent successfully",
      200
    );
  }

  async addIntegration(req: Request & IReqObject, res: Response) {
    const user = req["user"];
    const payload = req.body as {
      agent_id: string;
      type: IntegrationType;
      url: string;
    };

    await ZodValidation(addIntegrationSchema, payload, req.serverUrl!);

    // check if agent exists
    const agent = await prisma.agents.findFirst({
      where: {
        id: payload.agent_id,
        userId: user.id,
      },
    });

    if (!agent) {
      throw new HttpException(RESPONSE_CODE.NOT_FOUND, "Agent not found", 404);
    }

    // check if integration already exists
    const integration = await prisma.integration.findFirst({
      where: {
        agent_id: payload.agent_id,
        type: payload.type as IntegrationType,
      },
    });

    if (integration) {
      throw new HttpException(
        RESPONSE_CODE.DUPLICATE_ENTRY,
        "Integration already exists",
        400
      );
    }

    // validate url
    if (payload.type === "google_calendar") {
      const url = new URL(payload.url);
      if (url.hostname !== "calendar.app.google") {
        throw new HttpException(
          RESPONSE_CODE.BAD_REQUEST,
          "Invalid Google calendar URL",
          400
        );
      }
    }

    // add integration
    await prisma.integration.create({
      data: {
        agent_id: payload.agent_id,
        type: payload.type as IntegrationType,
        url: payload.url,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Integration added successfully",
      200
    );
  }

  async getIntegration(req: Request & IReqObject, res: Response) {
    const agentId = req.params["agent_id"];

    const integration = await prisma.integration.findMany({
      where: {
        agent_id: agentId,
      },
      select: {
        id: true,
        type: true,
        url: true,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Integration retrieved successfully",
      200,
      integration
    );
  }

  async removeIntegration(req: Request & IReqObject, res: Response) {
    const agentId = req.params["agent_id"];
    const intId = req.params["int_id"];

    const integration = await prisma.integration.findFirst({
      where: {
        id: intId,
        agent_id: agentId,
      },
    });

    if (!integration) {
      throw new HttpException(
        RESPONSE_CODE.NOT_FOUND,
        "Integration not found",
        404
      );
    }

    await prisma.integration.delete({
      where: {
        id: integration.id,
      },
    });

    return sendResponse.success(
      res,
      RESPONSE_CODE.SUCCESS,
      "Integration removed successfully",
      200
    );
  }
}
