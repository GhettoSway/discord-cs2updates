import axios from 'axios';
import dotenv from 'dotenv';
import { Client, IntentsBitField } from 'discord.js';
import { readFileSync, writeFileSync } from 'node:fs';

dotenv.config();

if (!process.env.token || !process.env.channelId) throw new Error('Configure your .env correctly');

const client = new Client({ intents: [IntentsBitField.Flags.Guilds] });

client.login(process.env.token);

client.on('ready', () => {
	console.log('client is ready!');
	checkForUpdate(client);
});

async function fetchPatchNotes() {
	const url = [
		'https://store.steampowered.com/',
		'events/ajaxgetpartnereventspageable/',
		'?clan_accountid=0',
		'&appid=730',
		'&offset=0',
		'&count=2', // 2 to make sure we fetch patch notes (in theory 1 could result only blogpost being returned)
		'&l=english',
		'&origin=https://www.counter-strike.net',
	].join('');

	const data = { description: '', title: '', error: false, release: 0 };
	try {
		const resData = (await axios.get(url)).data;

		for (const event of resData.events) {
			/* 
             after some testing/research it seems that
			 event_type 12 = patch notes ( https://www.counter-strike.net/news/updates )
			 event_type 13 = blogpost ( https://www.counter-strike.net/news )
            */

			if (event.event_type === 13) continue;

			data.description = parsePatchNoteBody(event.announcement_body.body);
			data.title = event.announcement_body.headline;
			data.release = event.announcement_body.posttime;
		}
	} catch (error) {
		data.error = true;
		data.description = `fetch failed with status code ${error.response.status}, err msg: ${error.response.data.err_msg}`;
	}

	return data;
}

function parsePatchNoteBody(text) {
	const imgTagRegex = /\[img\]([^\]]+)\[\/img\]/; // regular expression to match  [img]...[/img] tags

	// prettier-ignore
	return text
		.replace(imgTagRegex, '')      // remove the [img]...[/img] tags from the text argument
		.trim()                        // remove extra line breaks (in case img was at the bgn or at the end)
		.replace(/[\r\n]{2,}/g, '\n'); // replace all multiple line breaks (\n+\n) with one line break
}

async function checkForUpdate(client) {
	const latestUpdate = await fetchPatchNotes();

	// db query for latest sent update
	const sentUpdate = parseInt(readFileSync('./sentUpdate.txt', 'utf-8')) || 1;

	if (latestUpdate.release > sentUpdate && !latestUpdate.error) {
		console.log('new update!');
		const channel = client.channels.cache.get(process.env.channelId);
		const embedColor = parseInt(process.env.embedColor);
		await channel.send({
			embeds: [
				{
					title: latestUpdate.title,
					url: 'https://www.counter-strike.net/news/updates',
					color: isNaN(embedColor) ? 15754298 : embedColor,
					description: latestUpdate.description,
					timestamp: new Date(),
					thumbnail: process.env.thumbnail ? { url: process.env.thumbnail } : { url: channel.guild.iconURL() },
					footer: { text: 'Counter-Strike 2 Patch Notes' },
				},
			],
		});

		// replace previous value of sentUpdate in db with ${latestUpdate.release}
		writeFileSync('./sentUpdate.txt', latestUpdate.release.toString());
	}
	const interval = parseInt(process.env.interval) * 1000;

	setTimeout(checkForUpdate.bind(null, client), isNaN(interval) ? 6e4 : interval);
}
