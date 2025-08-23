import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const RPC_RISE = process.env.RPC_RISE;
const WETH_ADDRESS = process.env.WETH_ADDRESS;
const SWAP_MODE = process.env.SWAP_MODE || "both";
const SWAP_AMOUNT = parseFloat(process.env.SWAP_AMOUNT || "0.001");
const LOOP_COUNT = parseInt(process.env.LOOP_COUNT || "1");
const RANDOMIZE = process.env.RANDOMIZE === "true";
const AUTO_DAILY = process.env.AUTO_DAILY === "true";

let proxy = null;
try {
  proxy = fs.readFileSync("proxy.txt", "utf-8").trim();
} catch {
  console.log("No proxy.txt found, running without proxy...");
}

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address owner) view returns (uint256)"
];

function getProvider(rpc) {
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    const customFetch = (req, init) => fetch(req, { ...init, agent });
    return new ethers.JsonRpcProvider(rpc, undefined, { fetch: customFetch });
  }
  return new ethers.JsonRpcProvider(rpc);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

// === Load Private Keys ===
const rawKeys = fs.readFileSync("privatekey.txt", "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(Boolean);

const privateKeys = [];
rawKeys.forEach((key, i) => {
  if (/^([0-9a-fA-F]{64}|0x[0-9a-fA-F]{64})$/.test(key)) {
    privateKeys.push(key.startsWith("0x") ? key : "0x" + key);
  } else {
    console.log(`Warning: Invalid key at line ${i + 1}: ${key}`);
  }
});

if (privateKeys.length === 0) {
  console.error("ERROR: No valid private keys in privatekey.txt");
  process.exit(1);
}

console.log("======================================");
console.log("   RISE TESTNET BOT - LIGHT MODE");
console.log("======================================");
console.log(`Wallets loaded: ${privateKeys.length}`);
console.log(`Swap Mode: ${SWAP_MODE}`);
console.log(`Amount: ${SWAP_AMOUNT} ETH`);
console.log(`Loops: ${LOOP_COUNT}`);
console.log(`Randomize: ${RANDOMIZE}`);
console.log(`Auto Daily: ${AUTO_DAILY}`);
console.log("--------------------------------------");

let txCounter = 0;

async function runBot() {
  const provider = getProvider(RPC_RISE);
  const wallets = privateKeys.map(pk => new ethers.Wallet(pk, provider));
  const wethContracts = wallets.map(w => new ethers.Contract(WETH_ADDRESS, WETH_ABI, w));

  for (let i = 1; i <= LOOP_COUNT; i++) {
    console.log(`\n=== Loop ${i}/${LOOP_COUNT} ===`);
    for (let idx = 0; idx < wallets.length; idx++) {
      const wallet = wallets[idx];
      const shortAddr = wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4);
      const weth = wethContracts[idx];

      try {
        let amount = SWAP_AMOUNT;
        if (RANDOMIZE) {
          const variance = SWAP_AMOUNT * 0.1;
          amount = randomInRange(SWAP_AMOUNT - variance, SWAP_AMOUNT + variance);
        }
        const parsedAmount = ethers.parseEther(amount.toFixed(6));

        if (SWAP_MODE === "eth->weth" || SWAP_MODE === "both") {
          const ethBal = await provider.getBalance(wallet.address);
          if (ethBal >= parsedAmount) {
            const tx = await weth.deposit({ value: parsedAmount });
            console.log(`[${shortAddr}] ETH->WETH TX: ${tx.hash}`);
            await tx.wait();
            txCounter++;
            console.log(`[${shortAddr}] Confirmed | TX#${txCounter}`);
            await randomDelay();
          } else {
            console.log(`[${shortAddr}] Skip ETH->WETH (low ETH)`);
          }
        }

        if ((SWAP_MODE === "weth->eth" || SWAP_MODE === "both")) {
          const wethBal = await weth.balanceOf(wallet.address);
          if (wethBal > 0n) {
            const tx2 = await weth.withdraw(wethBal);
            console.log(`[${shortAddr}] WETH->ETH TX: ${tx2.hash}`);
            await tx2.wait();
            txCounter++;
            console.log(`[${shortAddr}] Confirmed | TX#${txCounter}`);
            await randomDelay();
          } else {
            console.log(`[${shortAddr}] Skip WETH->ETH (no WETH)`);
          }
        }
      } catch (err) {
        console.log(`[${shortAddr}] Error: ${err.message}`);
      }
    }
  }
}

async function randomDelay() {
  const delay = Math.floor(randomInRange(8000, 20000));
  console.log(`Delay ${Math.floor(delay / 1000)} detik...`);
  await sleep(delay);
}

(async () => {
  do {
    await runBot();
    if (AUTO_DAILY) {
      console.log(`\nAuto Daily active. Waiting 24 hours before next run...`);
      await sleep(86400000);
    }
  } while (AUTO_DAILY);
})();
