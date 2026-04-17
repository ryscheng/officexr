// ─── Loot Box Items: AI-themed collectibles with CSGO-style rarities ────────

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface LootItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: Rarity;
  category: 'tool' | 'model' | 'paper' | 'concept' | 'dataset';
}

export interface InventoryItem extends LootItem {
  /** Unique instance ID (same item can appear multiple times) */
  instanceId: string;
  obtainedAt: number;
}

export const RARITY_CONFIG: Record<Rarity, {
  label: string;
  color: string;
  glowColor: string;
  bgGradient: string;
  weight: number;
  confetti: boolean;
}> = {
  common:    { label: 'Common',    color: '#b0c3d9', glowColor: 'rgba(176,195,217,0.4)', bgGradient: 'linear-gradient(135deg, #2a3a4a, #3a4a5a)', weight: 50, confetti: false },
  uncommon:  { label: 'Uncommon',  color: '#5e98d9', glowColor: 'rgba(94,152,217,0.5)',  bgGradient: 'linear-gradient(135deg, #1a3050, #2a4a6a)', weight: 28, confetti: false },
  rare:      { label: 'Rare',      color: '#4b69ff', glowColor: 'rgba(75,105,255,0.5)',  bgGradient: 'linear-gradient(135deg, #1a1a50, #2a2a7a)', weight: 14, confetti: true },
  epic:      { label: 'Epic',      color: '#8847ff', glowColor: 'rgba(136,71,255,0.6)',  bgGradient: 'linear-gradient(135deg, #2a1050, #4a1a7a)', weight: 6,  confetti: true },
  legendary: { label: 'Legendary', color: '#eb4b4b', glowColor: 'rgba(235,75,75,0.7)',   bgGradient: 'linear-gradient(135deg, #4a1010, #7a1a1a)', weight: 2,  confetti: true },
};

export const LOOT_ITEMS: LootItem[] = [
  // ── Common: Everyday AI tools ─────────────────────────────────────────────
  { id: 'chatgpt',          name: 'ChatGPT',             emoji: '💬', rarity: 'common', category: 'tool',    description: 'The chatbot that started it all' },
  { id: 'google-search',    name: 'Google Search',        emoji: '🔍', rarity: 'common', category: 'tool',    description: 'Still the first place you look' },
  { id: 'stackoverflow',    name: 'Stack Overflow',       emoji: '📚', rarity: 'common', category: 'tool',    description: 'Copy-paste driven development' },
  { id: 'jupyter',          name: 'Jupyter Notebook',     emoji: '📓', rarity: 'common', category: 'tool',    description: 'Run code in cells, restart kernel, repeat' },
  { id: 'colab',            name: 'Google Colab',         emoji: '☁️', rarity: 'common', category: 'tool',    description: 'Free GPUs, what could go wrong?' },
  { id: 'vscode',           name: 'VS Code',              emoji: '💻', rarity: 'common', category: 'tool',    description: 'The editor that ate the world' },
  { id: 'github-copilot',   name: 'GitHub Copilot',       emoji: '🤖', rarity: 'common', category: 'tool',    description: 'Your AI pair programmer' },
  { id: 'pip-install',      name: 'pip install',          emoji: '📦', rarity: 'common', category: 'tool',    description: 'Dependency hell, one package at a time' },
  { id: 'regex',            name: 'Regular Expressions',  emoji: '🧩', rarity: 'common', category: 'tool',    description: 'Now you have two problems' },
  { id: 'mnist',            name: 'MNIST Dataset',        emoji: '✍️', rarity: 'common', category: 'dataset', description: 'The hello world of machine learning' },

  // ── Uncommon: Frameworks & Libraries ──────────────────────────────────────
  { id: 'pytorch',          name: 'PyTorch',              emoji: '🔥', rarity: 'uncommon', category: 'tool',    description: 'Dynamic graphs go brrr' },
  { id: 'tensorflow',       name: 'TensorFlow',           emoji: '🧮', rarity: 'uncommon', category: 'tool',    description: 'Google\'s tensor wrangler' },
  { id: 'huggingface',      name: 'Hugging Face',         emoji: '🤗', rarity: 'uncommon', category: 'tool',    description: 'Transformers for everyone' },
  { id: 'langchain',        name: 'LangChain',            emoji: '🔗', rarity: 'uncommon', category: 'tool',    description: 'Chain all the things' },
  { id: 'numpy',            name: 'NumPy',                emoji: '🔢', rarity: 'uncommon', category: 'tool',    description: 'The foundation of scientific Python' },
  { id: 'sklearn',          name: 'scikit-learn',         emoji: '🎓', rarity: 'uncommon', category: 'tool',    description: 'ML before deep learning was cool' },
  { id: 'wandb',            name: 'Weights & Biases',     emoji: '📊', rarity: 'uncommon', category: 'tool',    description: 'Because you need to track all those runs' },
  { id: 'imagenet',         name: 'ImageNet',             emoji: '🖼️', rarity: 'uncommon', category: 'dataset', description: '14 million images, hand-labeled with love' },
  { id: 'cuda',             name: 'CUDA Cores',           emoji: '⚡', rarity: 'uncommon', category: 'tool',    description: 'The GPU whisperer' },
  { id: 'docker',           name: 'Docker Container',     emoji: '🐳', rarity: 'uncommon', category: 'tool',    description: 'It works on my machine, literally' },

  // ── Rare: Influential Papers ──────────────────────────────────────────────
  { id: 'attention-paper',  name: 'Attention Is All You Need', emoji: '👁️', rarity: 'rare', category: 'paper', description: 'The paper that changed everything (2017)' },
  { id: 'resnet-paper',     name: 'Deep Residual Learning',   emoji: '🏗️', rarity: 'rare', category: 'paper', description: 'Skip connections for the win' },
  { id: 'gan-paper',        name: 'Generative Adversarial Nets', emoji: '🎭', rarity: 'rare', category: 'paper', description: 'Two networks walk into a bar...' },
  { id: 'bert-paper',       name: 'BERT Paper',            emoji: '📖', rarity: 'rare', category: 'paper',   description: 'Bidirectional transformers go brr' },
  { id: 'diffusion-paper',  name: 'Denoising Diffusion',   emoji: '🌊', rarity: 'rare', category: 'paper',   description: 'From noise to masterpiece' },
  { id: 'alphafold-paper',  name: 'AlphaFold Paper',       emoji: '🧬', rarity: 'rare', category: 'paper',   description: 'Protein folding? Solved.' },
  { id: 'word2vec',         name: 'Word2Vec',              emoji: '📐', rarity: 'rare', category: 'concept', description: 'King - Man + Woman = Queen' },
  { id: 'batch-norm',       name: 'Batch Normalization',   emoji: '⚖️', rarity: 'rare', category: 'concept', description: 'Normalize everything, ask questions later' },

  // ── Epic: Foundational Models ─────────────────────────────────────────────
  { id: 'gpt-4',            name: 'GPT-4',                emoji: '🧠', rarity: 'epic', category: 'model',   description: 'The big brain energy model' },
  { id: 'claude',           name: 'Claude',               emoji: '🎩', rarity: 'epic', category: 'model',   description: 'Helpful, harmless, and honest' },
  { id: 'dalle',            name: 'DALL-E',               emoji: '🎨', rarity: 'epic', category: 'model',   description: 'Text in, art out' },
  { id: 'stable-diffusion', name: 'Stable Diffusion',     emoji: '🖌️', rarity: 'epic', category: 'model',   description: 'Open source image generation' },
  { id: 'midjourney',       name: 'Midjourney',           emoji: '✨', rarity: 'epic', category: 'model',   description: 'Making artists nervous since 2022' },
  { id: 'alphago',          name: 'AlphaGo',              emoji: '⚫', rarity: 'epic', category: 'model',   description: 'The move that made humanity gasp' },

  // ── Legendary: Breakthrough Concepts ──────────────────────────────────────
  { id: 'transformer',      name: 'Transformer Architecture', emoji: '⚡', rarity: 'legendary', category: 'concept', description: 'Self-attention changed the game forever' },
  { id: 'backprop',         name: 'Backpropagation',          emoji: '🔄', rarity: 'legendary', category: 'concept', description: 'The algorithm that makes learning possible' },
  { id: 'gpu-cluster',      name: 'H100 GPU Cluster',         emoji: '🏭', rarity: 'legendary', category: 'tool',    description: 'A small nation\'s GDP worth of compute' },
  { id: 'agi',              name: 'Artificial General Intelligence', emoji: '🌟', rarity: 'legendary', category: 'concept', description: 'The holy grail... or is it?' },
];

/** Pick a random item weighted by rarity */
export function rollLootItem(): LootItem {
  const totalWeight = Object.values(RARITY_CONFIG).reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * totalWeight;

  // Build a pool grouped by rarity
  const byRarity = new Map<Rarity, LootItem[]>();
  for (const item of LOOT_ITEMS) {
    const list = byRarity.get(item.rarity) ?? [];
    list.push(item);
    byRarity.set(item.rarity, list);
  }

  for (const [rarity, config] of Object.entries(RARITY_CONFIG) as [Rarity, typeof RARITY_CONFIG[Rarity]][]) {
    roll -= config.weight;
    if (roll <= 0) {
      const pool = byRarity.get(rarity) ?? [];
      return pool[Math.floor(Math.random() * pool.length)];
    }
  }

  // Fallback — should never happen
  return LOOT_ITEMS[0];
}

/** Generate a sequence of items for the spinning strip (mostly filler, target inserted at a known index) */
export function generateSpinStrip(target: LootItem, totalItems = 60, landingIndex = 45): LootItem[] {
  const strip: LootItem[] = [];
  for (let i = 0; i < totalItems; i++) {
    if (i === landingIndex) {
      strip.push(target);
    } else {
      // Random filler — weighted but doesn't matter too much
      strip.push(rollLootItem());
    }
  }
  return strip;
}
