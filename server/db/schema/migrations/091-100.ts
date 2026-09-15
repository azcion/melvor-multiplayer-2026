import type { Migration } from '../types';

export const migrations_091_100: Migration[] = [{
	version: 91,
	sql: `
		CREATE TABLE support_team_welcome_localizations (
			team_id INTEGER NOT NULL REFERENCES support_teams (id) ON DELETE CASCADE,
			language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 64),
			source_content TEXT NOT NULL CHECK (length(source_content) BETWEEN 1 AND 1000),
			content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 5000),
			PRIMARY KEY (team_id, language)
		);

		WITH localization(language, content) AS (VALUES
			('zh-CN', '欢迎来到 Melvor Multiplayer！\n\n这是一条自动消息。如果你遇到任何问题或有任何建议，直接在这里回复即可。我们很期待听到你的声音！'),
			('zh-TW', '歡迎來到 Melvor Multiplayer！\n\n這是一則自動訊息。如果你遇到任何問題或有任何建議，直接在這裡回覆即可。我們很期待聽到你的聲音！'),
			('fr', 'Bienvenue dans Melvor Multiplayer !\n\nCeci est un message automatique. Si vous rencontrez un problème ou souhaitez faire une suggestion, répondez simplement ici. Nous serons ravis de vous lire !'),
			('de', 'Willkommen bei Melvor Multiplayer!\n\nDies ist eine automatische Nachricht. Wenn du auf ein Problem stößt oder einen Vorschlag hast, antworte einfach hier. Wir freuen uns, von dir zu hören!'),
			('pt', 'Bem-vindo ao Melvor Multiplayer!\n\nEsta é uma mensagem automática. Se tiveres algum problema ou uma sugestão, basta responderes aqui. Teremos todo o gosto em ouvir-te!'),
			('pt-br', 'Boas-vindas ao Melvor Multiplayer!\n\nEsta é uma mensagem automática. Se você tiver algum problema ou sugestão, é só responder por aqui. Vamos adorar ouvir você!'),
			('it', 'Ti diamo il benvenuto su Melvor Multiplayer!\n\nQuesto è un messaggio automatico. Se riscontri un problema o hai un suggerimento, rispondi qui. Saremo felici di ascoltarti!'),
			('ko', 'Melvor Multiplayer에 오신 것을 환영합니다!\n\n이 메시지는 자동으로 전송되었습니다. 문제를 겪고 있거나 제안하고 싶은 내용이 있다면 여기에 답장해 주세요. 여러분의 이야기를 기다리고 있겠습니다!'),
			('ja', 'Melvor Multiplayerへようこそ！\n\nこれは自動メッセージです。問題が発生した場合やご提案がある場合は、こちらに返信してください。皆さんの声をお待ちしています！'),
			('es', '¡Te damos la bienvenida a Melvor Multiplayer!\n\nEste es un mensaje automático. Si tienes algún problema o alguna sugerencia, responde aquí. ¡Nos encantará saber de ti!'),
			('ru', 'Добро пожаловать в Melvor Multiplayer!\n\nЭто автоматическое сообщение. Если у вас возникла проблема или есть предложение, просто ответьте здесь. Будем рады вас выслушать!'),
			('tr', 'Melvor Multiplayer’a hoş geldiniz!\n\nBu otomatik bir mesajdır. Bir sorunla karşılaşırsanız veya öneriniz varsa buradan yanıt vermeniz yeterli. Sizden haber almak isteriz!')
		)
		INSERT INTO support_team_welcome_localizations (team_id, language, source_content, content)
		SELECT id, language, welcome_content, content FROM support_teams CROSS JOIN localization
		WHERE system_key = 'multiplayer_mod_team';

		WITH localization(language, content) AS (VALUES
			('zh-CN', '欢迎来到 SUPER AWESOME EXPANSION！\n\n这是来自 EdwinNarwhal 的自动消息，哔哔啵啵。你有问题、疑虑或建议吗？来这里尽管说！直接回复这条消息就好。期待你的来信！'),
			('zh-TW', '歡迎來到 SUPER AWESOME EXPANSION！\n\n這是來自 EdwinNarwhal 的自動訊息，嗶嗶啵啵。你有問題、疑慮或建議嗎？來這裡儘管說！直接回覆這則訊息就好。期待你的來信！'),
			('fr', 'Bienvenue dans SUPER AWESOME EXPANSION !\n\nCeci est un message automatique d’EdwinNarwhal, bip boup. Vous avez une question, une inquiétude ou une suggestion ? C’est ici qu’il faut vous exprimer ! Répondez simplement à ce message. Au plaisir de vous lire !'),
			('de', 'Willkommen bei SUPER AWESOME EXPANSION!\n\nDies ist eine automatische Nachricht von EdwinNarwhal, piep boop. Hast du eine Frage, ein Anliegen oder einen Vorschlag? Hier kannst du alles loswerden! Antworte einfach direkt auf diese Nachricht. Ich freue mich, von dir zu hören!'),
			('pt', 'Bem-vindo ao SUPER AWESOME EXPANSION!\n\nEsta é uma mensagem automática do EdwinNarwhal, bip bop. Tens alguma pergunta, preocupação ou sugestão? Este é o sítio certo para a partilhares! Basta responderes aqui a esta mensagem. Fico a aguardar notícias tuas!'),
			('pt-br', 'Boas-vindas ao SUPER AWESOME EXPANSION!\n\nEsta é uma mensagem automática do EdwinNarwhal, bip bop. Tem alguma pergunta, preocupação ou sugestão? Este é o lugar para falar! É só responder aqui mesmo. Estou ansioso para ouvir você!'),
			('it', 'Ti diamo il benvenuto in SUPER AWESOME EXPANSION!\n\nQuesto è un messaggio automatico di EdwinNarwhal, bip bup. Hai una domanda, un dubbio o un suggerimento? Questo è il posto giusto per parlarne! Rispondi direttamente a questo messaggio. Non vedo l’ora di sentirti!'),
			('ko', 'SUPER AWESOME EXPANSION에 오신 것을 환영합니다!\n\nEdwinNarwhal이 보내는 자동 메시지입니다. 삐빅, 뿌뿌. 질문이나 걱정되는 점, 제안하고 싶은 내용이 있나요? 바로 여기에서 들려주세요! 이 메시지에 답장하시면 됩니다. 여러분의 이야기를 기다리고 있겠습니다!'),
			('ja', 'SUPER AWESOME EXPANSIONへようこそ！\n\nEdwinNarwhalからの自動メッセージです。ピポパポ。質問や気になること、ご提案はありますか？ぜひここでお聞かせください！このメッセージにそのまま返信できます。皆さんの声を楽しみにしています！'),
			('es', '¡Te damos la bienvenida a SUPER AWESOME EXPANSION!\n\nEste es un mensaje automático de EdwinNarwhal, bip bop. ¿Tienes alguna pregunta, inquietud o sugerencia? ¡Este es el lugar para contárnosla! Responde aquí mismo a este mensaje. ¡Estoy deseando saber de ti!'),
			('ru', 'Добро пожаловать в SUPER AWESOME EXPANSION!\n\nЭто автоматическое сообщение от EdwinNarwhal, бип-буп. У вас есть вопрос, замечание или предложение? Здесь можно смело высказаться! Просто ответьте на это сообщение. Буду рад вас услышать!'),
			('tr', 'SUPER AWESOME EXPANSION’a hoş geldiniz!\n\nBu, EdwinNarwhal’dan gelen otomatik bir mesajdır, bip bop. Bir sorunuz, endişeniz veya öneriniz mi var? Tam da burada dile getirebilirsiniz! Bu mesaja buradan yanıt vermeniz yeterli. Sizden haber almayı dört gözle bekliyorum!')
		)
		INSERT INTO support_team_welcome_localizations (team_id, language, source_content, content)
		SELECT id, language, welcome_content, content FROM support_teams CROSS JOIN localization
		WHERE system_key = 'super_awesome_expansion';
	`
}];
