require('dotenv').config();
const axios = require('axios');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const ROLE_ID = process.env.ALERT_ROLE_ID;

const API_URL =
  'https://4277980205320394.hostedstatus.com/1.0/status/59db90dbcdeb2f04dadcf16d';

const INTERVAL = 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

/* ================= UTIL ================= */

const ts = d => `<t:${Math.floor(new Date(d).getTime() / 1000)}:F>`;

function emoji(status = '') {
  status = status.toLowerCase();
  if (status.includes('operational')) return '🟢';
  if (status.includes('degraded')) return '🟡';
  if (status.includes('partial')) return '🟠';
  return '🔴';
}

function statusColor(status = '', code = 0) {
  status = status.toLowerCase();
  if (status.includes('operational') || code === 100) return 0x2ECC71;
  if (status.includes('degraded') || code === 200) return 0xF1C40F;
  if (status.includes('partial') || code === 300) return 0xE67E22;
  return 0xE74C3C;
}

/* ================= EMBEDS ================= */

function buildEmbeds(result) {
  const embeds = [];

  embeds.push(
    new EmbedBuilder()
      .setTitle('📊 Roblox System Status (Realtime)')
      .setColor(
        statusColor(
          result.status_overall.status,
          result.status_overall.status_code
        )
      )
      .setDescription(
        `${emoji(result.status_overall.status)} **${result.status_overall.status}**\nUpdated ${ts(result.status_overall.updated)}`
      )
      .setTimestamp()
  );

  let svc = new EmbedBuilder()
    .setTitle('🧩 Services')
    .setColor(statusColor(result.status_overall.status));

  let count = 0;

  for (const s of result.status) {
    svc.addFields({
      name: `🔹 ${s.name}`,
      value: s.containers
        .map(c => `• ${c.name} — ${emoji(c.status)} ${c.status}`)
        .join('\n'),
      inline: false
    });

    count++;
    if (count === 3) {
      embeds.push(svc);
      svc = new EmbedBuilder()
        .setTitle('🧩 Services (cont.)')
        .setColor(statusColor(result.status_overall.status));
      count = 0;
    }
  }
  if (count > 0) embeds.push(svc);

  /* ===== INCIDENT ===== */
  if (result.incidents.length > 0) {
    for (const inc of result.incidents) {
      let desc = '';

      desc += `**${inc.name}**\n`;
      desc += `${inc.current_active ? 'Operational' : 'Resolved'}\n\n`;

      desc += `**Components**\n`;
      desc += inc.components_affected.map(c => c.name).join(', ');
      desc += `\n\n`;

      desc += `**Locations**\n`;
      desc += inc.containers_affected.map(c => c.name).join(', ');
      desc += `\n\n`;

      for (const m of inc.messages) {
        const label =
          m.details.toLowerCase().includes('operational')
            ? 'IDENTIFIED'
            : 'INVESTIGATING';

        desc += `${ts(m.datetime)}\n`;
        desc += `${label}\n\n`;
        desc += `${m.details}\n\n`;
      }

      embeds.push(
        new EmbedBuilder()
          .setTitle('🚨 Active Incident')
          .setColor(
            inc.messages.some(m =>
              m.details.toLowerCase().includes('operational')
            )
              ? 0x2ECC71
              : 0xE74C3C
          )
          .setDescription(desc)
      );
    }
  } else {
    embeds.push(
      new EmbedBuilder()
        .setTitle('🚨 Active Incident')
        .setColor(0x2ECC71)
        .setDescription('🟢 No active incidents')
    );
  }

  return embeds;
}

/* ================= REALTIME LOOP ================= */

let statusMessage = null;
let incidentPinged = false;

async function updateStatus() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const { data } = await axios.get(API_URL);
    const result = data.result;

    const embeds = buildEmbeds(result);

    /* === DETECT REAL PROBLEM === */
    const hasIncidentNeedingPing = result.incidents.some(inc =>
      inc.current_active &&
      !inc.messages.some(m =>
        m.details.toLowerCase().includes('operational')
      )
    );

    if (!statusMessage) {
      const msgs = await channel.messages.fetch({ limit: 1 });
      statusMessage = msgs.first();
      if (!statusMessage) {
        statusMessage = await channel.send({ embeds });
      }
    }

    /* === ROLE PING (ONLY IF NOT OPERATIONAL) === */
    if (hasIncidentNeedingPing && !incidentPinged) {
      await channel.send({
        content: `🚨 <@&${ROLE_ID}> **Roblox sedang mengalami gangguan aktif!**`
      });
      incidentPinged = true;
    }

    if (!hasIncidentNeedingPing) {
      incidentPinged = false;
    }

    await statusMessage.edit({ embeds });
    console.log('🔄 Status updated');

  } catch (err) {
    console.error('❌ Update failed:', err.message);
  }
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await updateStatus();
  setInterval(updateStatus, INTERVAL);
});

client.login(TOKEN);
