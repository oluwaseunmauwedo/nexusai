const inDev = import.meta.env.DEV;

const env = {
  CLIENT_BASE_URL: inDev
    ? "http://localhost:3010"
    : "https://nexusai-chatbot.vercel.app/",
  API_URL: inDev
    ? "http://localhost:4001/api"
    : "https://nexusai-ecow3.ondigitalocean.app/api",
};
export default env;
