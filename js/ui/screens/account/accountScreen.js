import { AuthQrSignInScreen } from "./authQrSignInScreen.js";

// Keep the legacy account route on the same Android-parity auth surface.
// Older deep links must not reopen the retired two-step account screen.
export const AccountScreen = AuthQrSignInScreen;
