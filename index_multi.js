import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

const RPC_RISE = process.env.RPC_RISE;
const WETH_ADDRESS = process.env.WETH_ADDRESS;
const NETWORK_NAME = "RISE TESTNET";

// === Load private keys & proxies ===
const privateKeys = fs.readFileSync("privatekey.txt", "utf-8").trim().split("\n");
const proxies = fs.readFileSync("proxy.txt", "utf-8").trim().split("\n");

const wallets = privateKeys.map((pk, i) => ({
  privateKey: pk.trim(),
  proxy: proxies[i] ? proxies[i].trim() : null
}));

// === ABI ===
const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// === Provider dengan Proxy ===
function getProvider(rpcUrl, proxy) {
  if (proxy) {
    try {
      const agent = new HttpsProxyAgent(proxy);
      // Custom fetch untuk override
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

// === Variabel ===
let transactionLogs = [];
let globalWallets = [];

// === Blessed UI ===
const screen = blessed.screen({
  smartCSR: true,
  title: "GasPump Swap - Multi Wallet",
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

figlet.text("NT EXHAUST".toUpperCase(), { font: "Speed", horizontalLayout: "default" }, (err, data) => {
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

// === Logging ===
function addLog(message, type = "system") {
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message;
  if (type === "system") coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
  if (type === "error") coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
  if (type === "success") coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
  transactionLogs.push(`{grey-fg}${timestamp}{/grey-fg} ${coloredMessage}`);
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}

// === Update semua wallet ===
async function updateAllWallets() {
  globalWallets = [];
  for (const w of wallets) {
    try {
      const provider = getProvider(RPC_RISE, w.proxy);
      const wallet = new ethers.Wallet(w.privateKey, provider);

      const nativeBalance = await provider.getBalance(wallet.address);
      const wethContract = new ethers.Contract(WETH_ADDRESS, ERC20ABI, provider);
      const wethBalance = await wethContract.balanceOf(wallet.address);

      globalWallets.push(wallet);
      addLog(
        `Wallet ${getShortAddress(wallet.address)} | ETH: ${Number(ethers.formatEther(nativeBalance)).toFixed(4)} | WETH: ${Number(ethers.formatEther(wethBalance)).toFixed(4)} | Proxy: ${w.proxy || "none"}`,
        "system"
      );
    } catch (err) {
      addLog(`Error wallet ${w.privateKey.slice(0,6)}..: ${err.message}`, "error");
    }
  }
}

// === Jalankan ===
screen.key(["escape", "q", "C-c"], () => process.exit(0));
addLog("Multi-wallet bot started!", "system");
updateAllWallets();
