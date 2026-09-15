// Keep the legacy route name as a compatibility alias. Android presents QR
// and email authentication in one screen; Smart TV must do the same so old
// deep links cannot reopen the former two-step email dialog.
import { AuthQrSignInScreen } from "./authQrSignInScreen.js";

export const AuthSignInScreen = AuthQrSignInScreen;
