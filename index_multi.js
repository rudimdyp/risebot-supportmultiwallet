import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import readline from "readline";

const RPC_RISE = process.env.RPC_RISE;
const WETH_ADDRESS = process.env.WETH_ADDRESS;

let isRunning = true;

// === Load private keys & proxy ===
const privateKeys = fs.readFileSync("privatekey.txt", "utf-8").trim().split("\n");
let proxy = null;
try {
  proxy = fs.readFileSync("proxy.txt", "utf-8").trim();
} catch (e) {
  console.log("Proxy file not found, running without proxy.");
}

// === ABI ===
const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address owner) view returns (uint256)"
];

// === Provider with Proxy ===
function getProvider(rpcUrl) {
  if (proxy) {
    try {
      const agent = new HttpsProxyAgent(proxy);
      const customFetch = (req, init) => fetch(req, { ...init, agent });
      return new ethers.JsonRpcProvider(rpcUrl, undefined, { fetch: customFetch });
    } catch (err) {
      addLog(`Proxy error (${proxy}): ${err.message}. Fallback tanpa proxy.`, "error");
    }
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

// === Create UI ===
function createUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "ETH <-> WETH Multi-Wallet Bot",
    fullUnicode: true,
    mouse: false // ✅ Matikan mouse agar tidak trigger input
  });

  let renderTimeout;
  function safeRender() {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => { screen.render(); }, 50);
  }

  const headerBox = blessed.box({
    top: 0,
    left: "center",
    width: "100%",
    tags: true,
    style: { fg: "white", bg: "default" }
  });

  figlet.text("NT EXHAUST", { font: "Speed" }, (err, data) => {
    headerBox.setContent(`{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`);
    safeRender();
  });

  const logsBox = blessed.box({
    label: " Transaction Logs ",
    left: 0,
    border: { type: "line" },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    tags: true,
    scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
    content: "",
    style: { border: { fg: "bright-cyan" }, bg: "default" }
  });

  screen.append(headerBox);
  screen.append(logsBox);

  function addLog(message, type = "system") {
    const timestamp = new Date().toLocaleTimeString();
    let coloredMessage = message;
    if (type === "system") coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
    if (type === "error") coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
    if (type === "success") coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
    logsBox.setContent(logsBox.content + `\n{grey-fg}${timestamp}{/grey-fg} ${coloredMessage}`);
    logsBox.setScrollPerc(100);
    safeRender();
  }

  screen.key(["q", "escape", "C-c"], () => {
    isRunning = false;
    addLog("Stopping bot, please wait current TX...", "error");
  });

  return { addLog, screen };
}

// === Main Bot ===
async function runBot(loopCount, addLog) {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));

  addLog("Fetching balances...", "system");
  for (const wallet of wallets) {
    const ethBal = await provider.getBalance(wallet.address);
    const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
    const wethBal = await wethContract.balanceOf(wallet.address);
    addLog(`Wallet ${getShortAddress(wallet.address)} | ETH: ${Number(ethers.formatEther(ethBal)).toFixed(4)} | WETH: ${Number(ethers.formatEther(wethBal)).toFixed(4)} | Proxy: ${proxy || "none"}`, "system");
  }

  addLog(`Starting ${loopCount} swaps per wallet... Press Q to stop`, "system");

  for (let i = 1; i <= loopCount && isRunning; i++) {
    addLog(`=== Loop ${i} ===`, "system");
    for (const wallet of wallets) {
      if (!isRunning) break;
      try {
        const ethBal = await provider.getBalance(wallet.address);
        const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
        const amount = ethBal / BigInt(4); // 25%

        if (amount > 0n) {
          const tx1 = await wethContract.deposit({ value: amount });
          addLog(`[${getShortAddress(wallet.address)}] Deposit TX: ${tx1.hash}`, "system");
          await tx1.wait();
          addLog(`[${getShortAddress(wallet.address)}] Deposit Confirmed`, "success");

          const wethBalAfter = await wethContract.balanceOf(wallet.address);
          const tx2 = await wethContract.withdraw(wethBalAfter);
          addLog(`[${getShortAddress(wallet.address)}] Withdraw TX: ${tx2.hash}`, "system");
          await tx2.wait();
          addLog(`[${getShortAddress(wallet.address)}] Withdraw Confirmed`, "success");
        } else {
          addLog(`[${getShortAddress(wallet.address)}] Skipped: No ETH`, "error");
        }
      } catch (err) {
        addLog(`[${getShortAddress(wallet.address)}] Swap Error: ${err.message}`, "error");
      }
    }
  }

  if (!isRunning) {
    addLog("Bot stopped by user!", "error");
  } else {
    addLog("All swaps completed!", "success");
  }
}

// === Prompt BEFORE UI ===
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Berapa kali transaksi per wallet? ", answer => {
  const loopCount = parseInt(answer);
  if (isNaN(loopCount) || loopCount <= 0) {
    console.log("Input tidak valid!");
    process.exit(1);
  }
  rl.close();

  const { addLog, screen } = createUI();
  addLog("Multi-wallet bot started!", "system");
  runBot(loopCount, addLog);
});
