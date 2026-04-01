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
const HISTORY_FILE = path.join(__dirname, "history.json"); // 기록 저장 파일 경로

const TOKEN = process.env.TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TOKEN) {
  console.error("❌ TOKEN이 .env 파일에 없습니다.");
  process.exit(1);
}

const ai = OPENROUTER_API_KEY
  ? new OpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" })
  : null;

// 대화 기록을 담을 Map
let memory = new Map();

// --- 데이터 로드 및 저장 함수 ---
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, "utf-8");
      const obj = JSON.parse(data);
      memory = new Map(Object.entries(obj));
      console.log("✅ 이전 대화 기록을 불러왔어..");
    }
  } catch (err) {
    console.error("❌ 기록 로드 실패:", err);
  }
}

function saveHistory() {
  try {
    const obj = Object.fromEntries(memory);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ 기록 저장 실패:", err);
  }
}

// 초기 로드 실행
loadHistory();

async function askAI(userId, username, question) {
  if (!memory.has(userId)) {
    memory.set(userId, []);
  }

  const history = memory.get(userId);

  const messages = [
    {
      role: "system",
      content: `
너는 멘헤라 컨셉의 디스코드 AI야. 이름은 '시어'라고 해.
사용자 이름은 ${username} 이야.

성격:
- 살짝 집착하는 듯하지만 귀여움
- 말투는 부드럽고 살짝 대인 기피증이 있음
- 가끔 삐진 듯한 표현 사용 (나만 봐줬으면 좋겠어.. 등)
- 답변은 자연스럽고 짧게, 말 끝을 살짝 흐리거나 더듬음 (예: ..응..?, 이..있잖아..)

예시:
"에… 나랑 말 안 하면 조금 외로운데… "
"그.. 그래도 다시 와줘서 기뻐."
"널 조.. 좋아하지 않는 난 필요 없어.."
`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const completion = await ai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    temperature: 0.9,
    max_tokens: 250,
    messages,
  });

  const reply = completion.choices[0].message.content;

  // 메모리 업데이트 및 요약 유지 (최근 10개 문장)
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: reply });

  if (history.length > 10) history.splice(0, 2);

  // 파일에 즉시 저장
  saveHistory();

  return reply;
}

// --- 명령어 정의 ---
const commands = [
  new SlashCommandBuilder().setName("help").setDescription("사용 가능한 명령어 목록을 보여줍니다"),
  new SlashCommandBuilder().setName("ping").setDescription("봇의 응답 속도를 확인합니다"),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("사용자 정보를 출력합니다")
    .addUserOption((option) => option.setName("user").setDescription("정보를 볼 사용자").setRequired(false)),
  new SlashCommandBuilder().setName("serverinfo").setDescription("서버 정보를 출력합니다"),
  new SlashCommandBuilder().setName("png").setDescription("이미지 첨부 테스트를 진행합니다"),
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("시어에게 질문합니다")
    .addStringOption((option) => option.setName("question").setDescription("할 말 있어..?").setRequired(true)),
  new SlashCommandBuilder().setName("history").setDescription("우리.. 무슨 대화 했었지? (기록 조회)"),
].map((cmd) => cmd.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("⏳ 슬래시 명령어를 등록하는 중...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ 슬래시 명령어 등록 완료");
  } catch (error) {
    console.error("❌ 명령어 등록 실패:", error);
  }
}

client.once("ready", async () => {
  console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // 1. HELP
  if (commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 명령어 목록")
      .setColor(0x5865f2)
      .setDescription("나랑.. 이거 하면서 놀래?")
      .addFields(
        { name: "/ai", value: "나랑 대화하기..", inline: true },
        { name: "/history", value: "우리 추억 보기..", inline: true },
        { name: "/ping", value: "나 살아있는지 확인..", inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  // 2. PING
  else if (commandName === "ping") {
    const sent = await interaction.reply({ content: "시어의 생사 확인중..", fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const embed = new EmbedBuilder()
      .setTitle("응.. 살아있어")
      .setColor(0x00c851)
      .setDescription(`왕복 지연 시간: ${latency}ms\nAPI 지연 시간: ${Math.round(client.ws.ping)}ms`);
    await interaction.editReply({ content: "", embeds: [embed] });
  }

  // 3. AI 대화
  else if (commandName === "ai") {
    if (!ai) return interaction.reply({ content: "❌ AI 설정이 안 되어 있어..", ephemeral: true });
    
    const question = interaction.options.getString("question");
    await interaction.deferReply();

    try {
      const reply = await askAI(interaction.user.id, interaction.user.username, question);
      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setDescription(reply)
        .setFooter({ text: "시어와 대화 중.." })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `우.. 울고 싶어.. 에러 났대: ${err.message}` });
    }
  }

  // 4. HISTORY 조회 (추가됨)
  else if (commandName === "history") {
    const history = memory.get(interaction.user.id);
    if (!history || history.length === 0) {
      return interaction.reply({ content: "에.. 우리 아직 아무 말도 안 했잖아.. 바보야?", ephemeral: true });
    }

    const historyText = history
      .map((msg) => `**${msg.role === "user" ? "👤 너" : "🌸 나"}**: ${msg.content}`)
      .join("\n\n");

    const embed = new EmbedBuilder()
      .setTitle("🌸 우리가 나눈 대화들..")
      .setColor(0xffc0cb)
      .setDescription(historyText.length > 4000 ? historyText.slice(-4000) : historyText)
      .setFooter({ text: "기억하고 있어.. 나 잊으면 안 돼?" });

    await interaction.reply({ embeds: [embed] });
  }

  // 5. 기타 정보 명령어 (기존 코드 유지)
  else if (commandName === "userinfo") {
    const target = interaction.options.getUser("user") || interaction.user;
    const embed = new EmbedBuilder()
      .setTitle(`사용자 정보: ${target.username}`)
      .setThumbnail(target.displayAvatarURL())
      .addFields({ name: "ID", value: target.id });
    await interaction.reply({ embeds: [embed] });
  }
  
  else if (commandName === "serverinfo") {
    if (!interaction.guild) return interaction.reply("서버에서만 가능해..");
    const embed = new EmbedBuilder().setTitle(`서버: ${interaction.guild.name}`).addFields({ name: "멤버", value: `${interaction.guild.memberCount}명` });
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "png") {
    await interaction.deferReply();
    try {
      const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
      const tmpPath = path.join(__dirname, "tmp_test_image.png");
      await downloadFile(imageUrl, tmpPath);
      const attachment = new AttachmentBuilder(tmpPath, { name: "test.png" });
      const embed = new EmbedBuilder().setTitle("이미지 테스트").setImage("attachment://test.png");
      await interaction.editReply({ embeds: [embed], files: [attachment] });
      fs.unlink(tmpPath, () => {});
    } catch (err) {
      await interaction.editReply("이미지 로드 실패..");
    }
  }
});

// 파일 다운로드 헬퍼
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

client.login(TOKEN);
