import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

const RPC_RISE = process.env.RPC_RISE;
const WETH_ADDRESS = process.env.WETH_ADDRESS;

const privateKeys = fs.readFileSync("privatekey.txt", "utf-8").trim().split("\n");
let proxy = null;
try {
  proxy = fs.readFileSync("proxy.txt", "utf-8").trim();
} catch (e) {
  console.log("Proxy file not found, running without proxy.");
}

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address owner) view returns (uint256)"
];

function getProvider(rpcUrl) {
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    const customFetch = (req, init) => fetch(req, { ...init, agent });
    return new ethers.JsonRpcProvider(rpcUrl, undefined, { fetch: customFetch });
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getShortAddress(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

// === UI Setup ===
const screen = blessed.screen({
  smartCSR: true,
  title: "Multi-Wallet Swap Bot",
  fullUnicode: true,
  mouse: true
});

let renderTimeout;
function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => screen.render(), 50);
}

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  tags: true
});
figlet.text("NT EXHAUST", { font: "Speed" }, (err, data) => {
  headerBox.setContent(`{center}{bright-cyan-fg}${data}{/bright-cyan-fg}`);
  safeRender();
});
screen.append(headerBox);

// Logs box
const logsBox = blessed.box({
  label: " Logs ",
  top: 8,
  left: 0,
  width: "100%",
  height: "70%",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true }
});
screen.append(logsBox);

function addLog(msg, type = "system") {
  const timestamp = new Date().toLocaleTimeString();
  let color = msg;
  if (type === "success") color = `{green-fg}${msg}{/green-fg}`;
  if (type === "error") color = `{red-fg}${msg}{/red-fg}`;
  logsBox.pushLine(`{gray-fg}${timestamp}{/gray-fg} ${color}`);
  logsBox.setScrollPerc(100);
  safeRender();
}

// === Menu ===
const menuBox = blessed.box({
  label: " Menu ",
  top: 8,
  left: "center",
  width: "80%",
  height: "70%",
  border: { type: "line" },
  tags: true,
  hidden: false
});
screen.append(menuBox);

let swapMode = "both";
let swapAmount = 0.001;
let loopCount = 1;

function showMenu() {
  menuBox.setContent(`
{center}{bold}=== Multi-Wallet Swap Menu ==={/bold}{/center}

[1] Swap Mode: {cyan-fg}${swapMode}{/cyan-fg} (options: eth->weth | weth->eth | both)
[2] Swap Amount: {cyan-fg}${swapAmount} ETH{/cyan-fg}
[3] Loop Count: {cyan-fg}${loopCount}{/cyan-fg}

[Enter] Start Swap
[Q] Exit Program
`);
  menuBox.hidden = false;
  logsBox.hidden = true;
  safeRender();
}
showMenu();

screen.key(["1"], () => {
  if (swapMode === "eth->weth") swapMode = "weth->eth";
  else if (swapMode === "weth->eth") swapMode = "both";
  else swapMode = "eth->weth";
  showMenu();
});

screen.key(["2"], () => {
  swapAmount += 0.001;
  if (swapAmount > 0.01) swapAmount = 0.001;
  showMenu();
});

screen.key(["3"], () => {
  loopCount++;
  if (loopCount > 10) loopCount = 1;
  showMenu();
});

let isRunning = false;
let stopRequested = false;

screen.key(["enter"], async () => {
  if (isRunning) return;
  menuBox.hidden = true;
  logsBox.hidden = false;
  safeRender();

  isRunning = true;
  stopRequested = false;
  addLog(`Starting swap: Mode=${swapMode}, Amount=${swapAmount} ETH, Loops=${loopCount}`, "system");
  await runSwap(swapMode, swapAmount, loopCount);
  isRunning = false;

  if (!stopRequested) {
    addLog("Swaps completed. Returning to menu...", "success");
    setTimeout(showMenu, 2000);
  }
});

screen.key(["q", "escape", "C-c"], () => {
  if (isRunning) {
    stopRequested = true;
    addLog("Stopping current swaps...", "error");
  } else {
    process.exit(0);
  }
});

// === Swap Logic ===
async function runSwap(mode, amountEth, loops) {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));
  const amount = ethers.parseEther(amountEth.toString());

  const wethContracts = wallets.map(w => new ethers.Contract(WETH_ADDRESS, WETH_ABI, w));

  for (let i = 1; i <= loops && !stopRequested; i++) {
    addLog(`Loop ${i}/${loops}`, "system");
    for (let idx = 0; idx < wallets.length && !stopRequested; idx++) {
      const wallet = wallets[idx];
      const weth = wethContracts[idx];
      try {
        if (mode === "eth->weth" || mode === "both") {
          const bal = await provider.getBalance(wallet.address);
          if (bal < amount) {
            addLog(`[${getShortAddress(wallet.address)}] Skipped ETH->WETH (low balance)`, "error");
          } else {
            const tx = await weth.deposit({ value: amount });
            addLog(`[${getShortAddress(wallet.address)}] ETH->WETH TX: ${tx.hash}`, "system");
            await tx.wait();
            addLog(`[${getShortAddress(wallet.address)}] ETH->WETH Confirmed`, "success");
          }
        }

        if ((mode === "weth->eth" || mode === "both") && !stopRequested) {
          const wbal = await weth.balanceOf(wallet.address);
          if (wbal > 0n) {
            const tx2 = await weth.withdraw(wbal);
            addLog(`[${getShortAddress(wallet.address)}] WETH->ETH TX: ${tx2.hash}`, "system");
            await tx2.wait();
            addLog(`[${getShortAddress(wallet.address)}] WETH->ETH Confirmed`, "success");
          } else {
            addLog(`[${getShortAddress(wallet.address)}] Skipped WETH->ETH (no WETH)`, "error");
          }
        }
      } catch (err) {
        addLog(`[${getShortAddress(wallet.address)}] Error: ${err.message}`, "error");
      }
      await sleep(1500); // short delay between wallets
    }
    await sleep(3000); // short delay between loops
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

safeRender();
