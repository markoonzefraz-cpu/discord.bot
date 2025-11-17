// === IMPORTS ===
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const express = require('express');

// === KEEP ALIVE SERVER (Replit) ===
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Keep-alive server running on port ${PORT}`));

// === CONFIG - REPLACE THESE VALUES ===
const TOKEN = 'TOKEN_ID';
const CLIENT_ID = 'YOUR_CLIENT_ID';
const GUILD_ID = 'YOUR_GUILD_ID';

const ADMIN_ROLE_NAME = 'The Administrator';
const CLASS_A_ROLE_NAME = 'Class - A';
const EVENTS_CHANNEL_ID = '1391657049594789998'; // ifevent target channel
const PING_ROLE_ID = '1414070060502356028'; // role ping used by ifevent

// === CREATE CLIENT ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

// === HELPER: sendWithTemporaryAccess ===
// Attempts to send to channel. If missing view/send/embed but bot has MANAGE_CHANNELS,
// it will temporarily add an overwrite for itself, send, then remove the overwrite.
async function sendWithTemporaryAccess(channel, payload, reason = 'Temporary send permission') {
  if (!channel || !channel.isTextBased?.()) throw new Error('Selected channel cannot receive messages (not text-based).');

  const clientUser = client.user;
  if (!clientUser) throw new Error('Client not ready.');

  const botPerms = channel.permissionsFor(clientUser);
  const needed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory
  ];

  // If bot already has required perms, just send
  if (botPerms?.has(needed, false)) {
    return channel.send(payload);
  }

  // If bot lacks perms but has MANAGE_CHANNELS, temporarily add an overwrite for itself
  const guildMember = await channel.guild.members.fetch(clientUser.id).catch(() => null);
  const botHasManageChannels = guildMember?.permissions?.has(PermissionFlagsBits.ManageChannels, false);

  if (!botHasManageChannels) {
    const missing = [];
    if (!botPerms) {
      missing.push('VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS');
    } else {
      if (!botPerms.has(PermissionFlagsBits.ViewChannel)) missing.push('VIEW_CHANNEL');
      if (!botPerms.has(PermissionFlagsBits.SendMessages)) missing.push('SEND_MESSAGES');
      if (!botPerms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EMBED_LINKS');
    }
    throw new Error(`Bot missing permissions in that channel: ${missing.join(', ')}. Either give the bot those permissions or give it MANAGE_CHANNELS so it can temporarily grant itself access.`);
  }

  let overwrite;
  try {
    overwrite = await channel.permissionOverwrites.create(clientUser.id, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true
    }, { reason });

    const sent = await channel.send(payload);

    // remove temporary overwrite (best effort)
    try {
      await channel.permissionOverwrites.delete(clientUser.id, { reason: 'Reverting temporary send permission' });
    } catch (e) {
      console.warn("Couldn't delete temporary overwrite:", e);
    }

    return sent;
  } catch (err) {
    // cleanup if something failed
    try {
      if (overwrite) await channel.permissionOverwrites.delete(clientUser.id).catch(() => {});
    } catch (_) {}
    throw err;
  }
}

// === DEFINE SLASH COMMANDS ===
// Note: We place required options before optional to satisfy Discord validation
const commands = [
  // /scrole (original multi-step DM flow)
  new SlashCommandBuilder()
    .setName('scrole')
    .setDescription('Administrator-only command.')
    .addStringOption(option =>
      option
        .setName('choice')
        .setDescription('Choose Accepted or Reject.')
        .setRequired(true)
        .addChoices(
          { name: 'Accepted', value: 'accepted' },
          { name: 'Reject', value: 'reject' }
        )
    ),

  // /eventnc (custom embed) — keep all existing features and add optional link button
  new SlashCommandBuilder()
    .setName('eventnc')
    .setDescription('Create and send a custom event embed (Admins only).')
    .addChannelOption(option =>
      option.setName('channel').setDescription('Channel to send embed in').setRequired(true)
    )
    .addStringOption(option => option.setName('content').setDescription('Message content above the embed').setRequired(false))
    .addStringOption(option => option.setName('author').setDescription('Author name').setRequired(false))
    .addStringOption(option => option.setName('author_icon_url').setDescription('Author icon URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(false))
    .addStringOption(option => option.setName('description').setDescription('Embed description').setRequired(false))
    .addStringOption(option => option.setName('image_url').setDescription('Image URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('thumbnail_url').setDescription('Thumbnail URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('rgb_color').setDescription('RGB color (example: 255,0,0) (optional)').setRequired(false))
    .addStringOption(option => option.setName('footer').setDescription('Footer text (optional)').setRequired(false))
    .addStringOption(option => option.setName('footer_icon_url').setDescription('Footer icon URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('datetime').setDescription('Date & time for event (YYYY-MM-DD HH:MM PST) (optional)').setRequired(false))
    .addStringOption(option => option.setName('link').setDescription('Optional URL to show as a button under the embed (optional)').setRequired(false)),

  // /ifevent (unchanged — auto-post to events channel, includes Discord button)
  new SlashCommandBuilder()
    .setName('ifevent')
    .setDescription('Creates and sends the Iron Fist Tryout embed.')
    .addStringOption(option =>
      option
        .setName('datetime')
        .setDescription('Date & time for the tryout (YYYY-MM-DD HH:MM PST)')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

// === REGISTER SLASH COMMANDS ===
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('⏳ Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered successfully!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
})();

// === BOT READY ===
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// === HANDLE COMMANDS ===
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // fetch member and roles (safe)
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const hasAdmin = member?.roles?.cache?.some(r => r.name === ADMIN_ROLE_NAME);
  const hasClassA = member?.roles?.cache?.some(r => r.name === CLASS_A_ROLE_NAME);
  const isAllowed = hasAdmin || hasClassA;

  // -------- /scrole (original flow) --------
  if (interaction.commandName === 'scrole') {
    if (!hasAdmin) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    const choice = interaction.options.getString('choice');

    await interaction.reply({
      content: `You selected **${choice}**. Please mention the user you want to message (e.g. @username).`,
    });

    const filter = m => m.author.id === interaction.user.id;
    let targetUser;
    try {
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
      const message = collected.first();
      targetUser = message.mentions.users.first();
      if (!targetUser) return interaction.followUp({ content: '❌ You did not mention a valid user.', ephemeral: true });
    } catch {
      return interaction.followUp({ content: '⌛ You did not mention a user in time.', ephemeral: true });
    }

    await interaction.followUp({ content: `✅ Mention valid! Now type the **message** to send to ${targetUser}.` });

    let customMessage;
    try {
      const collectedMessage = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
      customMessage = collectedMessage.first().content;
    } catch {
      return interaction.followUp({ content: '⌛ You did not provide a message in time.', ephemeral: true });
    }

    try {
      await targetUser.send(customMessage);
      await interaction.followUp({ content: `✅ Message successfully sent to ${targetUser}!` });
    } catch (err) {
      console.error('Error sending DM in /scrole:', err);
      await interaction.followUp({ content: '❌ Failed to send message. User may have DMs closed.' });
    }
    return;
  }

  // -------- /eventnc --------
  if (interaction.commandName === 'eventnc') {
    if (!isAllowed) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) return interaction.editReply({ content: '❌ Please select a text channel.' });

      const content = interaction.options.getString('content') || null;
      const author = interaction.options.getString('author') || null;
      const authorIcon = interaction.options.getString('author_icon_url') || null;
      const title = interaction.options.getString('title') || null;
      const description = interaction.options.getString('description') || null;
      const image = interaction.options.getString('image_url') || null;
      const thumbnail = interaction.options.getString('thumbnail_url') || null;
      const rgbColor = interaction.options.getString('rgb_color') || null;
      const footer = interaction.options.getString('footer') || null;
      const footerIcon = interaction.options.getString('footer_icon_url') || null;
      const datetime = interaction.options.getString('datetime') || null;
      const link = interaction.options.getString('link') || null;

      const embed = new EmbedBuilder();

      // Parse RGB color if provided (expects "R,G,B")
      if (rgbColor) {
        const parts = rgbColor.split(',').map(n => parseInt(n.trim()));
        if (parts.length === 3 && parts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
          const colorInt = (parts[0] << 16) + (parts[1] << 8) + parts[2];
          embed.setColor(colorInt);
        } else {
          embed.setColor(0x00ae86); // fallback
        }
      } else {
        embed.setColor(0x00ae86);
      }

      if (author) embed.setAuthor({ name: author, iconURL: authorIcon || null });
      if (title) embed.setTitle(title);
      if (description) embed.setDescription(description);
      if (image) embed.setImage(image);
      if (thumbnail) embed.setThumbnail(thumbnail);
      if (footer) embed.setFooter({ text: footer, iconURL: footerIcon || null });

      if (datetime) {
        const date = new Date(datetime + ' PST');
        if (!isNaN(date.getTime())) {
          const unix = Math.floor(date.getTime() / 1000);
          embed.addFields({ name: '🕒 Event Time', value: `<t:${unix}:F>\n<t:${unix}:R>` });
        } else {
          await interaction.editReply({ content: '❌ Invalid datetime format. Use YYYY-MM-DD HH:MM PST.' });
          return;
        }
      }

      // Build components array — add the user-specified link button only if provided
      const components = [];
      if (link) {
        // validate basic URL shape
        try {
          // will throw if invalid URL
          new URL(link);
          const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('🔗 Link')
              .setStyle(ButtonStyle.Link)
              .setURL(link)
          );
          components.push(buttonRow);
        } catch (err) {
          await interaction.editReply({ content: '❌ The provided link is not a valid URL.' });
          return;
        }
      }

      // Send embed to specified channel (uses helper for permission cases)
      try {
        await sendWithTemporaryAccess(channel, { content: content || null, embeds: [embed], components }, 'eventnc send');
        await interaction.editReply({ content: `✅ Embed successfully sent to <#${channel.id}>!` });
      } catch (sendErr) {
        console.error('eventnc send error:', sendErr);
        await interaction.editReply({ content: `❌ Could not send embed: ${sendErr.message}` });
      }
    } catch (err) {
      console.error('eventnc error:', err);
      await interaction.editReply({ content: `❌ Error building/sending embed: ${err.message}` });
    }
    return;
  }

  // -------- /ifevent --------
  if (interaction.commandName === 'ifevent') {
    if (!isAllowed) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const datetime = interaction.options.getString('datetime');
      const date = new Date(datetime + ' PST');
      if (isNaN(date.getTime())) {
        await interaction.editReply({ content: '❌ Invalid datetime format. Use YYYY-MM-DD HH:MM PST.' });
        return;
      }
      const unix = Math.floor(date.getTime() / 1000);
      const formattedTimestamp = `<t:${unix}:F>`;

      const user = interaction.user;
      const userAvatar = user.displayAvatarURL({ dynamic: true });
      const userRoleName = member?.roles?.cache?.find(r => [ADMIN_ROLE_NAME, CLASS_A_ROLE_NAME].includes(r.name))?.name || 'Member';
      const usedTime = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({
          name: 'Task Force Detachment, The Iron Fist',
          iconURL:
            'https://images-ext-1.discordapp.net/external/B4SyOTb--z2eujaCoVEg_-An4MikiUGy_n1ngphdHgY/%3Fsize%3D4096/https/cdn.discordapp.com/icons/1422806838860189719/5c67f61c22fcd3ce4601bd080476810e.png',
        })
        .setTitle('Iron Fist Tryout')
        .setDescription(
`Iron Fist is the main military force of the Security Corps, which mainly specializes in operating a wide selection of vehicles alongside a heavy arsenal such as ground and aerial vehicles, specifically tanks, Blackhawks, MRAPS, etc. Whilst being the largest TFD, some of the IF duties consist of patrolling around the site, assuring the security of all sites entirely, and neutralizing any hostile forces.

**Benefits upon joining:**
• Gain access to a large range of vehicles and weapons and overall sophisticated equipment
• Ability to patrol around the site at your desire
• Advanced on-site permissions

**Requirements:**
• Advanced Combat Level
• Tactical knowledge and sense
• Good communication skills
• Common sense
• Being able to join discord VC's.
• Be ranked Test Subject or higher in the Corporation
(IF/TFD Officer+ may help/spectate)

*Best of Luck,*
*"Semper Primus, Always First."*

**Time**
> ${formattedTimestamp}`)
        .setImage('https://cdn.discordapp.com/attachments/1423175621344886887/1424500278157250712/NH5e0SG.png')
        .setFooter({ text: `${user.username} ~ ${userRoleName} | ${usedTime}`, iconURL: userAvatar })
        .setTimestamp();

      // ActionRow with Discord invite button (only for /ifevent)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 Discord')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/wKkfBrBPzS')
      );

      const eventsChannel = await client.channels.fetch(EVENTS_CHANNEL_ID).catch(() => null);
      if (!eventsChannel || !eventsChannel.isTextBased()) {
        await interaction.editReply({ content: '❌ Events channel not found or not a text channel. Check EVENTS_CHANNEL_ID.' });
        return;
      }

      try {
        await sendWithTemporaryAccess(eventsChannel, {
          content: `||<@&${PING_ROLE_ID}>||`,
          embeds: [embed],
          components: [row]
        }, 'ifevent auto send');

        await interaction.editReply({ content: `✅ Iron Fist Tryout embed successfully sent to <#${EVENTS_CHANNEL_ID}>!` });
      } catch (sendErr) {
        console.error('/ifevent send error:', sendErr);
        await interaction.editReply({ content: `❌ Could not send embed: ${sendErr.message}` });
      }
    } catch (err) {
      console.error('/ifevent error:', err);
      await interaction.editReply({ content: `❌ Error building/sending embed: ${err.message}` });
    }
    return;
  }
});

// === LOGIN ===
client.login(TOKEN);
// === IMPORTS ===
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const express = require('express');

// === KEEP ALIVE SERVER (Replit) ===
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Keep-alive server running on port ${PORT}`));

// === CONFIG - REPLACE THESE VALUES ===
const TOKEN = 'MTQyOTMyNzUxNzg0NzkxNjcwNQ.GCOvlR.CwniMlgqAQo87hAIMcy7pw-PboWpLmbrRpuSLM';
const CLIENT_ID = '1429327517847916705';
const GUILD_ID = '1349164263133941821';

const ADMIN_ROLE_NAME = 'The Administrator';
const CLASS_A_ROLE_NAME = 'Class - A';
const EVENTS_CHANNEL_ID = '1391657049594789998'; // ifevent target channel
const PING_ROLE_ID = '1414070060502356028'; // role ping used by ifevent

// === CREATE CLIENT ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

// === HELPER: sendWithTemporaryAccess ===
// Attempts to send to channel. If missing view/send/embed but bot has MANAGE_CHANNELS,
// it will temporarily add an overwrite for itself, send, then remove the overwrite.
async function sendWithTemporaryAccess(channel, payload, reason = 'Temporary send permission') {
  if (!channel || !channel.isTextBased?.()) throw new Error('Selected channel cannot receive messages (not text-based).');

  const clientUser = client.user;
  if (!clientUser) throw new Error('Client not ready.');

  const botPerms = channel.permissionsFor(clientUser);
  const needed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory
  ];

  // If bot already has required perms, just send
  if (botPerms?.has(needed, false)) {
    return channel.send(payload);
  }

  // If bot lacks perms but has MANAGE_CHANNELS, temporarily add an overwrite for itself
  const guildMember = await channel.guild.members.fetch(clientUser.id).catch(() => null);
  const botHasManageChannels = guildMember?.permissions?.has(PermissionFlagsBits.ManageChannels, false);

  if (!botHasManageChannels) {
    const missing = [];
    if (!botPerms) {
      missing.push('VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS');
    } else {
      if (!botPerms.has(PermissionFlagsBits.ViewChannel)) missing.push('VIEW_CHANNEL');
      if (!botPerms.has(PermissionFlagsBits.SendMessages)) missing.push('SEND_MESSAGES');
      if (!botPerms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EMBED_LINKS');
    }
    throw new Error(`Bot missing permissions in that channel: ${missing.join(', ')}. Either give the bot those permissions or give it MANAGE_CHANNELS so it can temporarily grant itself access.`);
  }

  let overwrite;
  try {
    overwrite = await channel.permissionOverwrites.create(clientUser.id, {
      ViewChannel: true,
      SendMessages: true,
      EmbedLinks: true,
      ReadMessageHistory: true
    }, { reason });

    const sent = await channel.send(payload);

    // remove temporary overwrite (best effort)
    try {
      await channel.permissionOverwrites.delete(clientUser.id, { reason: 'Reverting temporary send permission' });
    } catch (e) {
      console.warn("Couldn't delete temporary overwrite:", e);
    }

    return sent;
  } catch (err) {
    // cleanup if something failed
    try {
      if (overwrite) await channel.permissionOverwrites.delete(clientUser.id).catch(() => {});
    } catch (_) {}
    throw err;
  }
}

// === DEFINE SLASH COMMANDS ===
// Note: We place required options before optional to satisfy Discord validation
const commands = [
  // /scrole (original multi-step DM flow)
  new SlashCommandBuilder()
    .setName('scrole')
    .setDescription('Administrator-only command.')
    .addStringOption(option =>
      option
        .setName('choice')
        .setDescription('Choose Accepted or Reject.')
        .setRequired(true)
        .addChoices(
          { name: 'Accepted', value: 'accepted' },
          { name: 'Reject', value: 'reject' }
        )
    ),

  // /eventnc (custom embed) — keep all existing features and add optional link button
  new SlashCommandBuilder()
    .setName('eventnc')
    .setDescription('Create and send a custom event embed (Admins only).')
    .addChannelOption(option =>
      option.setName('channel').setDescription('Channel to send embed in').setRequired(true)
    )
    .addStringOption(option => option.setName('content').setDescription('Message content above the embed').setRequired(false))
    .addStringOption(option => option.setName('author').setDescription('Author name').setRequired(false))
    .addStringOption(option => option.setName('author_icon_url').setDescription('Author icon URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(false))
    .addStringOption(option => option.setName('description').setDescription('Embed description').setRequired(false))
    .addStringOption(option => option.setName('image_url').setDescription('Image URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('thumbnail_url').setDescription('Thumbnail URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('rgb_color').setDescription('RGB color (example: 255,0,0) (optional)').setRequired(false))
    .addStringOption(option => option.setName('footer').setDescription('Footer text (optional)').setRequired(false))
    .addStringOption(option => option.setName('footer_icon_url').setDescription('Footer icon URL (optional)').setRequired(false))
    .addStringOption(option => option.setName('datetime').setDescription('Date & time for event (YYYY-MM-DD HH:MM PST) (optional)').setRequired(false))
    .addStringOption(option => option.setName('link').setDescription('Optional URL to show as a button under the embed (optional)').setRequired(false)),

  // /ifevent (unchanged — auto-post to events channel, includes Discord button)
  new SlashCommandBuilder()
    .setName('ifevent')
    .setDescription('Creates and sends the Iron Fist Tryout embed.')
    .addStringOption(option =>
      option
        .setName('datetime')
        .setDescription('Date & time for the tryout (YYYY-MM-DD HH:MM PST)')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

// === REGISTER SLASH COMMANDS ===
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('⏳ Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered successfully!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
})();

// === BOT READY ===
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// === HANDLE COMMANDS ===
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // fetch member and roles (safe)
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const hasAdmin = member?.roles?.cache?.some(r => r.name === ADMIN_ROLE_NAME);
  const hasClassA = member?.roles?.cache?.some(r => r.name === CLASS_A_ROLE_NAME);
  const isAllowed = hasAdmin || hasClassA;

  // -------- /scrole (original flow) --------
  if (interaction.commandName === 'scrole') {
    if (!hasAdmin) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    const choice = interaction.options.getString('choice');

    await interaction.reply({
      content: `You selected **${choice}**. Please mention the user you want to message (e.g. @username).`,
    });

    const filter = m => m.author.id === interaction.user.id;
    let targetUser;
    try {
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
      const message = collected.first();
      targetUser = message.mentions.users.first();
      if (!targetUser) return interaction.followUp({ content: '❌ You did not mention a valid user.', ephemeral: true });
    } catch {
      return interaction.followUp({ content: '⌛ You did not mention a user in time.', ephemeral: true });
    }

    await interaction.followUp({ content: `✅ Mention valid! Now type the **message** to send to ${targetUser}.` });

    let customMessage;
    try {
      const collectedMessage = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
      customMessage = collectedMessage.first().content;
    } catch {
      return interaction.followUp({ content: '⌛ You did not provide a message in time.', ephemeral: true });
    }

    try {
      await targetUser.send(customMessage);
      await interaction.followUp({ content: `✅ Message successfully sent to ${targetUser}!` });
    } catch (err) {
      console.error('Error sending DM in /scrole:', err);
      await interaction.followUp({ content: '❌ Failed to send message. User may have DMs closed.' });
    }
    return;
  }

  // -------- /eventnc --------
  if (interaction.commandName === 'eventnc') {
    if (!isAllowed) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) return interaction.editReply({ content: '❌ Please select a text channel.' });

      const content = interaction.options.getString('content') || null;
      const author = interaction.options.getString('author') || null;
      const authorIcon = interaction.options.getString('author_icon_url') || null;
      const title = interaction.options.getString('title') || null;
      const description = interaction.options.getString('description') || null;
      const image = interaction.options.getString('image_url') || null;
      const thumbnail = interaction.options.getString('thumbnail_url') || null;
      const rgbColor = interaction.options.getString('rgb_color') || null;
      const footer = interaction.options.getString('footer') || null;
      const footerIcon = interaction.options.getString('footer_icon_url') || null;
      const datetime = interaction.options.getString('datetime') || null;
      const link = interaction.options.getString('link') || null;

      const embed = new EmbedBuilder();

      // Parse RGB color if provided (expects "R,G,B")
      if (rgbColor) {
        const parts = rgbColor.split(',').map(n => parseInt(n.trim()));
        if (parts.length === 3 && parts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
          const colorInt = (parts[0] << 16) + (parts[1] << 8) + parts[2];
          embed.setColor(colorInt);
        } else {
          embed.setColor(0x00ae86); // fallback
        }
      } else {
        embed.setColor(0x00ae86);
      }

      if (author) embed.setAuthor({ name: author, iconURL: authorIcon || null });
      if (title) embed.setTitle(title);
      if (description) embed.setDescription(description);
      if (image) embed.setImage(image);
      if (thumbnail) embed.setThumbnail(thumbnail);
      if (footer) embed.setFooter({ text: footer, iconURL: footerIcon || null });

      if (datetime) {
        const date = new Date(datetime + ' PST');
        if (!isNaN(date.getTime())) {
          const unix = Math.floor(date.getTime() / 1000);
          embed.addFields({ name: '🕒 Event Time', value: `<t:${unix}:F>\n<t:${unix}:R>` });
        } else {
          await interaction.editReply({ content: '❌ Invalid datetime format. Use YYYY-MM-DD HH:MM PST.' });
          return;
        }
      }

      // Build components array — add the user-specified link button only if provided
      const components = [];
      if (link) {
        // validate basic URL shape
        try {
          // will throw if invalid URL
          new URL(link);
          const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('🔗 Link')
              .setStyle(ButtonStyle.Link)
              .setURL(link)
          );
          components.push(buttonRow);
        } catch (err) {
          await interaction.editReply({ content: '❌ The provided link is not a valid URL.' });
          return;
        }
      }

      // Send embed to specified channel (uses helper for permission cases)
      try {
        await sendWithTemporaryAccess(channel, { content: content || null, embeds: [embed], components }, 'eventnc send');
        await interaction.editReply({ content: `✅ Embed successfully sent to <#${channel.id}>!` });
      } catch (sendErr) {
        console.error('eventnc send error:', sendErr);
        await interaction.editReply({ content: `❌ Could not send embed: ${sendErr.message}` });
      }
    } catch (err) {
      console.error('eventnc error:', err);
      await interaction.editReply({ content: `❌ Error building/sending embed: ${err.message}` });
    }
    return;
  }

  // -------- /ifevent --------
  if (interaction.commandName === 'ifevent') {
    if (!isAllowed) return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const datetime = interaction.options.getString('datetime');
      const date = new Date(datetime + ' PST');
      if (isNaN(date.getTime())) {
        await interaction.editReply({ content: '❌ Invalid datetime format. Use YYYY-MM-DD HH:MM PST.' });
        return;
      }
      const unix = Math.floor(date.getTime() / 1000);
      const formattedTimestamp = `<t:${unix}:F>`;

      const user = interaction.user;
      const userAvatar = user.displayAvatarURL({ dynamic: true });
      const userRoleName = member?.roles?.cache?.find(r => [ADMIN_ROLE_NAME, CLASS_A_ROLE_NAME].includes(r.name))?.name || 'Member';
      const usedTime = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({
          name: 'Task Force Detachment, The Iron Fist',
          iconURL:
            'https://images-ext-1.discordapp.net/external/B4SyOTb--z2eujaCoVEg_-An4MikiUGy_n1ngphdHgY/%3Fsize%3D4096/https/cdn.discordapp.com/icons/1422806838860189719/5c67f61c22fcd3ce4601bd080476810e.png',
        })
        .setTitle('Iron Fist Tryout')
        .setDescription(
`Iron Fist is the main military force of the Security Corps, which mainly specializes in operating a wide selection of vehicles alongside a heavy arsenal such as ground and aerial vehicles, specifically tanks, Blackhawks, MRAPS, etc. Whilst being the largest TFD, some of the IF duties consist of patrolling around the site, assuring the security of all sites entirely, and neutralizing any hostile forces.

**Benefits upon joining:**
• Gain access to a large range of vehicles and weapons and overall sophisticated equipment
• Ability to patrol around the site at your desire
• Advanced on-site permissions

**Requirements:**
• Advanced Combat Level
• Tactical knowledge and sense
• Good communication skills
• Common sense
• Being able to join discord VC's.
• Be ranked Test Subject or higher in the Corporation
(IF/TFD Officer+ may help/spectate)

*Best of Luck,*
*"Semper Primus, Always First."*

**Time**
> ${formattedTimestamp}`)
        .setImage('https://cdn.discordapp.com/attachments/1423175621344886887/1424500278157250712/NH5e0SG.png')
        .setFooter({ text: `${user.username} ~ ${userRoleName} | ${usedTime}`, iconURL: userAvatar })
        .setTimestamp();

      // ActionRow with Discord invite button (only for /ifevent)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 Discord')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/wKkfBrBPzS')
      );

      const eventsChannel = await client.channels.fetch(EVENTS_CHANNEL_ID).catch(() => null);
      if (!eventsChannel || !eventsChannel.isTextBased()) {
        await interaction.editReply({ content: '❌ Events channel not found or not a text channel. Check EVENTS_CHANNEL_ID.' });
        return;
      }

      try {
        await sendWithTemporaryAccess(eventsChannel, {
          content: `||<@&${PING_ROLE_ID}>||`,
          embeds: [embed],
          components: [row]
        }, 'ifevent auto send');

        await interaction.editReply({ content: `✅ Iron Fist Tryout embed successfully sent to <#${EVENTS_CHANNEL_ID}>!` });
      } catch (sendErr) {
        console.error('/ifevent send error:', sendErr);
        await interaction.editReply({ content: `❌ Could not send embed: ${sendErr.message}` });
      }
    } catch (err) {
      console.error('/ifevent error:', err);
      await interaction.editReply({ content: `❌ Error building/sending embed: ${err.message}` });
    }
    return;
  }
});

// === LOGIN ===
client.login(TOKEN);
