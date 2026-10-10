// The parser lives in electron/ so the main process can use it too; see the notes there.
export { API_ORIGIN, APP_HOSTS, APP_ORIGIN, BOT_API_URL, APP_PROTOCOL, appLinkFor, isAppLink, parseDeepLink, webLink, type DeepLink } from "../../electron/deeplink";
