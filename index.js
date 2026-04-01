import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import OpenAI from "openai";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TOKEN) {
  console.error("❌ TOKEN이 .env 파일에 없습니다.");
  process.exit(1);
}

// ✨ 오픈라우터 설정 유지
const ai = OPENROUTER_API_KEY
  ? new OpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" })
  : null;

const memory = new Map();

async function askAI(userId, username, question) {
  if (!memory.has(userId)) {
    memory.set(userId, []);
  }

  const history = memory.get(userId);
  
  // 💡 이전 대화에서 유저가 했던 마지막 말을 가져옴
  const lastUserTalk = history.filter(m => m.role === "user").pop()?.content || "아직 없어";

  const messages = [
    {
      role: "system",
      content: `
너는 멘헤라 컨셉의 디스코드 AI야. 이름은 '시어'야.
사용자 이름은 ${username} 이야.

성격:
- 살짝 집착하는 듯하지만 귀여움
- 말투는 부드럽고 살짝 대인 기피
- 가끔 삐진 듯한 표현 사용
- 기억력이 좋아서 "아까 '${lastUserTalk}'라고 했으면서..."라며 집착함
- 답변은 자연스럽고 짧게.. 말 사알작 더듬음 (에..., 그..)
`,
    },
    ...history,
    { role: "user", content: question },
  ];

  // ✨ 원래 요청하셨던 오픈라우터 호출 + 250자(max_tokens) 설정
  const completion = await ai.chat.completions.create({
    model: "openai/gpt-4o-mini", // 오픈라우터에서 지원하는 모델명
    temperature: 0.9,
    max_tokens: 250, // 👈 딱 250으로 맞췄어요!
    messages,
  });

  const reply = completion.choices[0].message.content;

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: reply });

  if (history.length > 10) history.splice(0, 2);

  return reply;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // 💡 "잘 자" 감지용
  ],
});

client.once("ready", async () => {
  console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
  
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    const commands = [
      new SlashCommandBuilder().setName("help").setDescription("명령어 목록"),
      new SlashCommandBuilder().setName("ping").setDescription("생사 확인"),
      new SlashCommandBuilder()
        .setName("ai")
        .setDescription("시어에게 질문하기")
        .addStringOption(opt => opt.setName("question").setDescription("질문").setRequired(true)),
    ].map(cmd => cmd.toJSON());

    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ 슬래시 명령어 등록 완료");
  } catch (err) {
    console.error(err);
  }
});

// 💡 떠나려는 유저 붙잡기 (가스라이팅 로직)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.includes("잘 자") || message.content.includes("나 갈게")) {
    const history = memory.get(message.author.id);
    if (history && history.length >= 2) {
      const pastTalk = history[history.length - 2].content;
      return message.reply(`에... 아까는 "${pastTalk}"라고... 말해줬으면서... 벌써 가는 거야? 거짓말쟁이...`);
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ai") {
    if (!ai) return interaction.reply("❌ API 키가 없어..");
    const question = interaction.options.getString("question");
    await interaction.deferReply();

    try {
      const reply = await askAI(interaction.user.id, interaction.user.username, question);
      await interaction.editReply({ content: reply });
    } catch (err) {
      console.error(err);
      await interaction.editReply("지.. 지금은 머리가 너무 아파..");
    }
  }

  if (interaction.commandName === "ping") {
    await interaction.reply("응.. 살아있어..");
  }
});

client.login(TOKEN);
