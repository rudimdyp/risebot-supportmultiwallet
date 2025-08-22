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

// === Load private keys ===
const privateKeys = fs.readFileSync("privatekey.txt", "utf-8").trim().split("\n");

// === Load single proxy (rotating proxy) ===
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

// === Blessed UI ===
const screen = blessed.screen({
  smartCSR: true,
  title: "ETH <-> WETH Multi-Wallet Bot",
  fullUnicode: true,
  mouse: true
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
  if (err) headerBox.setContent("{center}{bold}NT Exhaust{/bold}{/center}");
  else headerBox.setContent(`{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`);
  safeRender();
});

const logsBox = blessed.box({
  label: " Transaction Logs ",
  left: 0,
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
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

// === Core Logic ===
async function runBot(loopCount) {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));

  addLog("Fetching balances...", "system");
  for (const wallet of wallets) {
    try {
      const ethBal = await provider.getBalance(wallet.address);
      const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
      const wethBal = await wethContract.balanceOf(wallet.address);

      addLog(`Wallet ${getShortAddress(wallet.address)} | ETH: ${Number(ethers.formatEther(ethBal)).toFixed(4)} | WETH: ${Number(ethers.formatEther(wethBal)).toFixed(4)} | Proxy: ${proxy || "none"}`, "system");
    } catch (err) {
      addLog(`Error reading ${wallet.address}: ${err.message}`, "error");
    }
  }

  addLog(`Starting ${loopCount} swaps per wallet...`, "system");

  for (let i = 1; i <= loopCount; i++) {
    addLog(`=== Loop ${i} ===`, "system");
    for (const wallet of wallets) {
      try {
        const ethBal = await provider.getBalance(wallet.address);
        const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
        const amount = ethBal / BigInt(2); // 50% ETH

        if (amount > 0n) {
          // Swap ETH -> WETH
          const tx1 = await wethContract.deposit({ value: amount });
          addLog(`[${getShortAddress(wallet.address)}] Deposit TX: ${tx1.hash}`, "system");
          await tx1.wait();
          addLog(`[${getShortAddress(wallet.address)}] Deposit Confirmed`, "success");

          // Swap WETH -> ETH
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

  addLog("All swaps completed!", "success");
}

// === Input prompt ===
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Berapa kali transaksi per wallet? ", answer => {
  const loopCount = parseInt(answer);
  if (isNaN(loopCount) || loopCount <= 0) {
    console.log("Input tidak valid!");
    process.exit(1);
  }
  rl.close();
  runBot(loopCount);
});

// === Exit shortcut ===
screen.key(["q", "escape", "C-c"], () => process.exit(0));
