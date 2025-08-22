import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

const RPC_RISE = process.env.RPC_RISE;
const WETH_ADDRESS = process.env.WETH_ADDRESS;

// === Fix parsing private keys ===
const privateKeys = fs.readFileSync("privatekey.txt", "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0)
  .map(key => key.startsWith("0x") ? key : "0x" + key);

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

// === UI Setup ===
const screen = blessed.screen({
  smartCSR: true,
  title: "RISE TESTNET BOT",
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

// === Change header text ===
figlet.text("RISE TESTNET BOT", { font: "Speed" }, (err, data) => {
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

// Menu box
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

// Nonce info box
const nonceBox = blessed.box({
  label: " Nonce Info ",
  top: 8,
  left: "center",
  width: "80%",
  height: "70%",
  border: { type: "line" },
  tags: true,
  hidden: true,
  scrollable: true,
  alwaysScroll: true
});
screen.append(nonceBox);

// Input prompt
const inputBox = blessed.prompt({
  parent: screen,
  border: "line",
  width: "50%",
  height: "25%",
  hidden: true,
  keys: true,
  tags: true,
  label: " Input ",
  content: "",
  padding: 1
});

function askInput(question, callback) {
  inputBox.readInput(question, "", (err, value) => {
    if (value) callback(value);
    showMenu();
  });
}

// === Variables ===
let swapMode = "both";
let swapAmount = 0.001;
let loopCount = 1;
let randomizeAmount = true;

let isRunning = false;
let stopRequested = false;

function showMenu() {
  menuBox.setContent(`
{center}{bold}=== RISE TESTNET BOT MENU ==={/bold}{/center}

[1] Swap Mode: {cyan-fg}${swapMode}{/cyan-fg} (toggle)
[2] Swap Amount: {cyan-fg}${swapAmount} ETH{/cyan-fg} (input)
[3] Loop Count: {cyan-fg}${loopCount}{/cyan-fg} (input)
[4] Randomize Amount: {cyan-fg}${randomizeAmount ? "ON" : "OFF"}{/cyan-fg}

[T] Lihat Nonce (jumlah transaksi)
[Enter] Start Swap
[Q] Exit Program
`);
  menuBox.hidden = false;
  logsBox.hidden = true;
  nonceBox.hidden = true;
  safeRender();
  showBalances();
}

// Show balances when menu visible
async function showBalances() {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));
  for (const w of wallets) {
    const ethBal = await provider.getBalance(w.address);
    const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, provider);
    const wethBal = await wethContract.balanceOf(w.address);
    addLog(`Wallet ${getShortAddress(w.address)} | ETH: ${Number(ethers.formatEther(ethBal)).toFixed(4)} | WETH: ${Number(ethers.formatEther(wethBal)).toFixed(4)}`);
  }
}

showMenu();

// Key handlers
screen.key(["1"], () => {
  if (swapMode === "eth->weth") swapMode = "weth->eth";
  else if (swapMode === "weth->eth") swapMode = "both";
  else swapMode = "eth->weth";
  showMenu();
});

screen.key(["2"], () => {
  inputBox.show();
  safeRender();
  askInput("Masukkan jumlah ETH per swap:", val => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) swapAmount = num;
  });
});

screen.key(["3"], () => {
  inputBox.show();
  safeRender();
  askInput("Masukkan jumlah loop:", val => {
    const num = parseInt(val);
    if (!isNaN(num) && num > 0) loopCount = num;
  });
});

screen.key(["4"], () => {
  randomizeAmount = !randomizeAmount;
  showMenu();
});

// Show Nonce info
screen.key(["t"], async () => {
  menuBox.hidden = true;
  logsBox.hidden = true;
  nonceBox.hidden = false;
  nonceBox.setContent("{center}Mengambil data nonce...{/center}");
  safeRender();

  const provider = getProvider(RPC_RISE);
  let content = "{center}{bold}Nonce per Wallet{/bold}{/center}\n\n";
  for (const pk of privateKeys) {
    const wallet = new ethers.Wallet(pk.trim());
    const nonce = await provider.getTransactionCount(wallet.address);
    content += `Wallet ${getShortAddress(wallet.address)} | TX Count: {cyan-fg}${nonce}{/cyan-fg}\n`;
  }
  content += "\n[B] Kembali ke Menu";
  nonceBox.setContent(content);
  safeRender();
});

// Back from nonce menu
screen.key(["b"], () => {
  if (!nonceBox.hidden) {
    nonceBox.hidden = true;
    showMenu();
  }
});

// Start Swap
screen.key(["enter"], async () => {
  if (isRunning) return;
  menuBox.hidden = true;
  logsBox.hidden = false;
  nonceBox.hidden = true;
  safeRender();

  isRunning = true;
  stopRequested = false;
  addLog(`Starting swap: Mode=${swapMode}, Amount=${swapAmount} ETH, Loops=${loopCount}`, "system");
  await runSwap(swapMode, swapAmount, loopCount, randomizeAmount);
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
async function runSwap(mode, amountEth, loops, randomize) {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));
  const wethContracts = wallets.map(w => new ethers.Contract(WETH_ADDRESS, WETH_ABI, w));

  for (let i = 1; i <= loops && !stopRequested; i++) {
    addLog(`Loop ${i}/${loops}`, "system");
    for (let idx = 0; idx < wallets.length && !stopRequested; idx++) {
      const wallet = wallets[idx];
      const weth = wethContracts[idx];
      try {
        let amount = amountEth;
        if (randomize) {
          const variance = amountEth * 0.1; // ±10%
          amount = randomInRange(amountEth - variance, amountEth + variance);
        }
        const parsedAmount = ethers.parseEther(amount.toFixed(6));

        if (mode === "eth->weth" || mode === "both") {
          const bal = await provider.getBalance(wallet.address);
          if (bal < parsedAmount) {
            addLog(`[${getShortAddress(wallet.address)}] Skipped ETH->WETH (low balance)`, "error");
          } else {
            const tx = await weth.deposit({ value: parsedAmount });
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
      await sleep(randomInRange(1000, 4000)); // random delay antar wallet
    }
    await sleep(randomInRange(3000, 6000)); // random delay antar loop
  }
}
safeRender();
