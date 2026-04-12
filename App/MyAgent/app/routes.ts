import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("chat/:agentId", "routes/chat.$agentId.tsx"),
  route("debate/:debateId", "routes/debate.$debateId.tsx"),
  route("agents/new", "routes/agents.new.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
