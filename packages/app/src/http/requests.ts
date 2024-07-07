import $axios from "./axios";

export const signInUser = async (data: any) => {
  const resp = await $axios.post("/auth/otp-auth", data);
  return resp.data;
};

export const login = async (data: any) => {
  const resp = await $axios.post("/auth/login", data);
  return resp.data;
};

// fetch users info
export const getUser = async () => {
  const req = await $axios.get("/user");
  return req.data;
};

// get agents
export const getAgents = async () => {
  const req = await $axios.get("/agents");
  return req.data;
};

export const getAgent = async (id: string) => {
  const req = await $axios.get(`/agent/${id}`);
  return req.data;
};

export const getAgentSettings = async (id: string) => {
  const req = await $axios.get(`/agent/settings/${id}`);
  return req.data;
};

export const activateAgent = async (id: string) => {
  const req = await $axios.patch(`/agent/activate/${id}`);
  return req.data;
};

export const updateAgentSettings = async (data: any) => {
  const req = await $axios.patch(`/agent/settings`, data);
  return req.data;
};

export const createAgent = async (data: any) => {
  const req = await $axios.post("/agent", data);
  return req.data;
};

export const getVerifiedNumbers = async () => {
  const req = await $axios.get("/agent/verified-numbers");
  return req.data;
};

export const sendOTP = async (data: any) => {
  const req = await $axios.post("/agent/send-otp", data);
  return req.data;
};

export const verifyPhone = async (data: any) => {
  const req = await $axios.post("/agent/verify-phone", data);
  return req.data;
};

export const getAgentFwdNumber = async (id: string) => {
  const req = await $axios.get(`/agent/forward-number/${id}`);
  return req.data;
};

export const getAgentPhoneNumbers = async (id: string) => {
  const req = await $axios.get(`/agent/active-number/${id}`);
  return req.data;
};

export const getTwAvailableNumbers = async () => {
  const req = await $axios.get(`/agent/tw/available-numbers`);
  return req.data;
};

/* Flow: BuyNumber -> getCheckoutUrl */
export const buyPhoneNumber = async (data: any) => {
  const req = await $axios.post(`/checkout/tw-phone/buy`, data);
  return req.data;
};

export const getCheckoutUrl = async () => {
  const req = await $axios.get(`/checkout/tw-phone`);
  return req.data;
};
/* End of flow */

export const addKnowledgeBase = async (data: any) => {
  const req = await $axios.post("/knowledge-base", data, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return req.data;
};

export const crawlWebpage = async (data: any) => {
  const req = await $axios.post("/knowledge-base/crawl-page", data);
  return req.data;
};

export const getKnowledgeBase = async (id: string) => {
  const req = await $axios.get(`/knowledge-base/${id}`);
  return req.data;
};

export const getAllKnowledgeBase = async () => {
  const req = await $axios.get(`/knowledge-base`);
  return req.data;
};

export const linkKnowledgeBase = async (data: any) => {
  const req = await $axios.post(`/knowledge-base/link`, data);
  return req.data;
};

export const retrainKbData = async (data: any) => {
  const req = await $axios.post(`/knowledge-base/retrain`, data);
  return req.data;
};

export const deleteKnowledgeBase = async (data: {
  agent_id: string;
  kb_id: string;
}) => {
  const req = await $axios.delete(
    `/knowledge-base/${data.agent_id}/${data.kb_id}`
  );
  return req.data;
};

export const unlinkKnowledgeBase = async (data: any) => {
  const req = await $axios.post(`/knowledge-base/unlink`, data);
  return req.data;
};

export const addIntegration = async (data: any) => {
  const req = await $axios.post(`/agent/integration`, data);
  return req.data;
};

export const getIntegration = async (id: string) => {
  const req = await $axios.get(`/agent/integration/${id}`);
  return req.data;
};

export const deleteIntegration = async (agent_id: string, int_id: string) => {
  const req = await $axios.delete(`/agent/integration/${agent_id}/${int_id}`);
  return req.data;
};

// Call Logs
export const getCallLogs = async (page: number, limit: number) => {
  const req = await $axios.get(`/call-logs?page=${page}&limit=${limit}`);
  return req.data;
};

export const getUnreadLogs = async () => {
  const req = await $axios.get(`/call-logs/unread`);
  return req.data;
};

export const markLogAsRead = async (id: string) => {
  const req = await $axios.patch(`/call-logs/mark-read/${id}`);
  return req.data;
};

export const getCallLogAnalysis = async (id: string) => {
  const req = await $axios.get(`/call-logs/analysis/${id}`);
  return req.data;
};
