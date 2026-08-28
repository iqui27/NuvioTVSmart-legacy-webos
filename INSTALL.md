# Installing this build on an LG TV

There are two ways to get an `.ipk` onto a webOS TV. Which one applies to you
depends on whether your TV is rooted.

Everything here needs the TV and the computer on the **same network**.

---

## The normal path: Developer Mode + webOS Dev Manager (no rooting)

This is what most people want. Nothing is modified permanently on the TV, and it
works on a stock set.

**1. Turn on Developer Mode on the TV.**
Open the LG Content Store, search for **Developer Mode**, install it, and sign in
with a free [LG developer account](https://webostv.developer.lge.com/). Turn Dev
Mode **on** — the TV reboots. Note the **IP address** and the **six-character
passphrase** the app shows.

**2. Install webOS Dev Manager on your computer.**
[github.com/webosbrew/dev-manager-desktop](https://github.com/webosbrew/dev-manager-desktop)
— a graphical tool from the webosbrew project that talks to the TV over the
network, so you do not need the command line or LG's SDK. Grab the build for your
system from its
[releases page](https://github.com/webosbrew/dev-manager-desktop/releases):
`.msi` for Windows, `.dmg` for macOS, `.AppImage` for Linux.

**3. Add the TV in Dev Manager.**
_More → Add Device_, then:

| field      | value                                          |
| ---------- | ---------------------------------------------- |
| host / IP  | the address the Developer Mode app shows       |
| port       | `9922`                                         |
| user       | `prisoner`                                     |
| passphrase | the six characters from the Developer Mode app |

**4. Install the IPK.**
Download the `.ipk` from [our releases](https://github.com/iqui27/NuvioTVSmart-legacy-webos/releases),
then in Dev Manager open the **Apps** page and use **Install** (top right) to pick
the file. The app appears in the TV's launcher when it finishes.

### The catch nobody warns you about

**The Developer Mode session expires.** LG gives you a limited window (extendable
from the Developer Mode app), and when it lapses **apps installed this way stop
launching**. Open the Developer Mode app on the TV and extend the session to bring
them back. This is LG's restriction, not something this build does — and it is the
single most common reason people think a sideloaded app "broke".

---

## What about the Homebrew Channel?

Short answer: not supported here, on purpose.

The Homebrew Channel installs from repositories that publish a manifest carrying a
checksum for each release. Setting that up is not hard, but keeping it correct on
every release is ongoing work — and nobody involved in this fork has a rooted TV,
so the install flow could never be tested from here. A documented path that nobody
has ever walked is worse than no path: it sends people chasing an error we cannot
reproduce.

The Developer Mode route above works on a stock TV, needs no rooting, and is what
this project actually tests on real hardware.

---

## Which release do I want?

| your TV                               | release                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| webOS 4.x (2018-2019: C9, C8, B9, B8) | the latest normal release                                                                      |
| webOS 5.0+ (2020 and newer)           | the [official Nuvio build](https://github.com/NuvioMedia/NuvioTVSmart/releases), not this fork |
| webOS 3.x (2016-2017)                 | experimental preview only — see the pre-release marked `webos3`                                |

Not sure which you have? On the TV: _Settings → All Settings → General → About
This TV_.
