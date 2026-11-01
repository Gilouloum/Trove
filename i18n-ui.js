// ── INTERFACE TRANSLATION ────────────────────────────────────────────────────
// Most of Trove's interface is written in English straight into index.html and the templates in
// renderer.js and friends. Rather than thread t() through hundreds of templates, this translates
// the interface as it appears on screen: a text node, or a title / placeholder / aria-label,
// whose text matches an English entry in UI_TEXT is shown in the chosen language, and put back
// when the language changes. Text with numbers in it goes through UI_PATTERNS instead.
//
// Matching is whole-text and exact, so a file or folder name is only ever touched if it is
// literally one of these phrases (the built-in section names - Trips, People, Cameras... - are
// meant to be: they are shown translated, but stored unchanged). Leading emoji/symbols and
// trailing arrows are kept as they are around the translated words. Anything typed (inputs,
// text areas, editable text) and anything under [data-no-i18n] is never touched.
//
// New interface text: prefer t() with an I18N entry in renderer.js; text written straight into
// a template needs an entry here (English → [fr, de, es, zh]) or it stays English.
//
// Loaded before renderer.js; uiI18nStart() is called from init() once the language is known.

const UI_LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', zh: 'zh-CN' };
function uiLocale() { return UI_LOCALES[typeof currentLang === 'string' ? currentLang : 'en'] || 'en-US'; }
const UI_LANG_INDEX = { fr: 0, de: 1, es: 2, zh: 3 };

const UI_TEXT = {
  // Sidebar
  'No copies, just shortcuts - saving space and making your photos easier to find.': ['Pas de copies, juste des raccourcis : moins de place prise et des photos plus faciles à retrouver.', 'Keine Kopien, nur Verknüpfungen: spart Platz und macht Ihre Fotos leichter auffindbar.', 'Sin copias, solo accesos directos: ahorra espacio y tus fotos son más fáciles de encontrar.', '不复制,只建立快捷方式:节省空间,让照片更容易找到。'],
  'Library': ['Bibliothèque', 'Bibliothek', 'Biblioteca', '照片库'],
  'Photo Library': ['Photothèque', 'Fotobibliothek', 'Fototeca', '照片库'],
  'To Sort': ['À trier', 'Zu sortieren', 'Por ordenar', '待整理'],
  'Trips': ['Voyages', 'Reisen', 'Viajes', '旅行'],
  'Vacations': ['Voyages', 'Reisen', 'Viajes', '旅行'],
  'Adventures': ['Aventures', 'Abenteuer', 'Aventuras', '探险'],
  'People': ['Personnes', 'Personen', 'Personas', '人物'],
  'Categories': ['Catégories', 'Kategorien', 'Categorías', '分类'],
  'Cameras': ['Appareils', 'Kameras', 'Cámaras', '相机'],
  'Location': ['Lieux', 'Orte', 'Ubicaciones', '地点'],
  'Add Section…': ['Ajouter une section…', 'Bereich hinzufügen…', 'Añadir sección…', '添加分区…'],
  'New Section…': ['Nouvelle section…', 'Neuer Bereich…', 'Nueva sección…', '新建分区…'],
  'New Section': ['Nouvelle section', 'Neuer Bereich', 'Nueva sección', '新建分区'],
  'Create a brand-new top-level section, like Trips or People, with its own name and icon - or bring back a hidden one': ['Créer une nouvelle section principale, comme Voyages ou Personnes, avec son nom et son icône, ou en faire réapparaître une masquée', 'Einen neuen Hauptbereich wie Reisen oder Personen mit eigenem Namen und Symbol anlegen, oder einen ausgeblendeten zurückholen', 'Crea una sección principal nueva, como Viajes o Personas, con su nombre e icono, o recupera una oculta', '新建一个顶级分区(如旅行或人物),设置名称和图标,或恢复已隐藏的分区'],
  'Total size of the files in your library. Trove links to them where they are, so this space is on your drives, not inside Trove.': ["Taille totale des fichiers de votre bibliothèque. Trove les relie là où ils sont : cet espace est sur vos disques, pas dans Trove.", 'Gesamtgröße der Dateien in Ihrer Bibliothek. Trove verknüpft sie dort, wo sie liegen: Dieser Platz ist auf Ihren Laufwerken, nicht in Trove.', 'Tamaño total de los archivos de tu biblioteca. Trove los enlaza donde están: ese espacio está en tus discos, no dentro de Trove.', '照片库中文件的总大小。Trove 只链接到文件原位置,这些空间在你的磁盘上,不在 Trove 内。'],
  'View and restore backups': ['Voir et restaurer les sauvegardes', 'Sicherungen ansehen und wiederherstellen', 'Ver y restaurar copias de seguridad', '查看和恢复备份'],
  'Last saved -': ['Dernier enregistrement : -', 'Zuletzt gespeichert: -', 'Último guardado: -', '上次保存:-'],
  'Total disk space freed by deleting files through Trove - Duplicate Detection, Burst Review, and manual deletes': ["Espace disque libéré en supprimant des fichiers avec Trove : doublons, rafales et suppressions manuelles", 'Durch das Löschen von Dateien mit Trove freigegebener Speicher: Duplikate, Serienbilder und manuelles Löschen', 'Espacio liberado al borrar archivos con Trove: duplicados, ráfagas y borrados manuales', '通过 Trove 删除文件释放的磁盘空间:重复项、连拍和手动删除'],
  'Nothing freed yet': ["Rien de libéré pour l'instant", 'Noch nichts freigegeben', 'Aún no se ha liberado nada', '尚未释放空间'],
  'Full photo editor - layers, text, selections, brushes. Pick a photo straight from your library, edit it, then export. Nothing is saved unless you save it.': ["Éditeur photo complet : calques, texte, sélections, pinceaux. Choisissez une photo de votre bibliothèque, modifiez-la, puis exportez. Rien n'est enregistré tant que vous n'enregistrez pas.", 'Vollständiger Fotoeditor: Ebenen, Text, Auswahlen, Pinsel. Foto aus der Bibliothek wählen, bearbeiten, exportieren. Nichts wird gespeichert, bevor Sie speichern.', 'Editor de fotos completo: capas, texto, selecciones, pinceles. Elige una foto de tu biblioteca, edítala y expórtala. Nada se guarda hasta que guardes.', '完整的照片编辑器:图层、文字、选区、画笔。从照片库选一张照片,编辑后导出。不保存就不会改动任何内容。'],
  'Settings': ['Paramètres', 'Einstellungen', 'Ajustes', '设置'],
  'Account and app settings': ["Réglages du compte et de l'application", 'Konto- und App-Einstellungen', 'Ajustes de la cuenta y de la app', '账户和应用设置'],
  'An update has been downloaded in the background - click to restart Trove and apply it': ["Une mise à jour a été téléchargée en arrière-plan : cliquez pour redémarrer Trove et l'appliquer", 'Ein Update wurde im Hintergrund geladen: Klicken, um Trove neu zu starten und es zu installieren', 'Se ha descargado una actualización en segundo plano: haz clic para reiniciar Trove y aplicarla', '更新已在后台下载完成:点击重启 Trove 以应用'],
  'Update ready': ['Mise à jour prête', 'Update bereit', 'Actualización lista', '更新已就绪'],
  'Restart now': ['Redémarrer', 'Jetzt neu starten', 'Reiniciar ahora', '立即重启'],
  'Empty - tap to add a folder here': ['Vide : cliquez pour ajouter un dossier ici', 'Leer: tippen, um hier einen Ordner hinzuzufügen', 'Vacío: toca para añadir una carpeta aquí', '空:点击在此添加文件夹'],
  'No cameras detected yet': ['Aucun appareil détecté pour le moment', 'Noch keine Kameras erkannt', 'Aún no se han detectado cámaras', '尚未检测到相机'],
  'No GPS locations yet': ['Aucune position GPS pour le moment', 'Noch keine GPS-Orte', 'Aún no hay ubicaciones GPS', '尚无 GPS 位置'],
  'No folders yet.': ["Aucun dossier pour l'instant.", 'Noch keine Ordner.', 'Aún no hay carpetas.', '还没有文件夹。'],
  'No folders yet': ["Aucun dossier pour l'instant", 'Noch keine Ordner', 'Aún no hay carpetas', '还没有文件夹'],

  // Top bar, sorting, views
  'All Files': ['Tous les fichiers', 'Alle Dateien', 'Todos los archivos', '所有文件'],
  'Search: fpv florida, iphone iceland…': ['Rechercher : plage coucher de soleil, iphone islande…', 'Suchen: Strand Sonnenuntergang, iPhone Island…', 'Buscar: playa atardecer, iphone islandia…', '搜索:海滩 日落、iphone 冰岛…'],
  'Clear search': ['Effacer la recherche', 'Suche löschen', 'Borrar búsqueda', '清除搜索'],
  'File Date = when it was taken. Date Added = when you imported it. Type = grouped by file extension, with a Select all per group.': ["Date du fichier = date de prise de vue. Date d'ajout = date d'import. Type = regroupé par extension, avec un Tout sélectionner par groupe.", 'Dateidatum = Aufnahmedatum. Hinzugefügt = Importdatum. Typ = nach Dateiendung gruppiert, mit Alle auswählen pro Gruppe.', 'Fecha del archivo = cuándo se tomó. Fecha de añadido = cuándo lo importaste. Tipo = agrupado por extensión, con Seleccionar todo por grupo.', '文件日期 = 拍摄时间。添加日期 = 导入时间。类型 = 按扩展名分组,每组可全选。'],
  'Name': ['Nom', 'Name', 'Nombre', '名称'],
  'Type': ['Type', 'Typ', 'Tipo', '类型'],
  'Size': ['Taille', 'Größe', 'Tamaño', '大小'],
  'Date Added': ["Date d'ajout", 'Hinzugefügt', 'Fecha de añadido', '添加日期'],
  'File Date': ['Date du fichier', 'Dateidatum', 'Fecha del archivo', '文件日期'],
  'Toggle direction': ['Inverser le sens', 'Richtung umkehren', 'Invertir orden', '切换方向'],
  'Grid': ['Grille', 'Raster', 'Cuadrícula', '网格'],
  'List': ['Liste', 'Liste', 'Lista', '列表'],
  'Timeline': ['Chronologie', 'Zeitleiste', 'Cronología', '时间线'],
  'Sort': ['Trier', 'Sortieren', 'Ordenar', '整理'],
  'Tidy up your library: find new people, sort the To Sort pile, find duplicates and edited photos': ['Rangez votre bibliothèque : trouvez de nouvelles personnes, triez la pile À trier, trouvez les doublons et les photos retouchées', 'Bibliothek aufräumen: neue Personen finden, den Stapel Zu sortieren abarbeiten, Duplikate und bearbeitete Fotos finden', 'Ordena tu biblioteca: encuentra personas nuevas, ordena la pila Por ordenar, encuentra duplicados y fotos editadas', '整理照片库:找出新人物、整理待整理照片、查找重复项和编辑过的照片'],
  'Globe': ['Globe', 'Globus', 'Globo', '地球'],
  'Add Files': ['Ajouter des fichiers', 'Dateien hinzufügen', 'Añadir archivos', '添加文件'],
  'Add': ['Ajouter', 'Hinzufügen', 'Añadir', '添加'],
  'Files': ['fichiers', 'Dateien', 'archivos', '文件'],

  // Selection bar, filters
  'Reveal': ['Afficher', 'Anzeigen', 'Mostrar', '显示位置'],
  'Opens Explorer with all selected files highlighted, ready to drag/move together': ["Ouvre l'Explorateur avec tous les fichiers sélectionnés, prêts à être glissés ou déplacés ensemble", 'Öffnet den Explorer mit allen ausgewählten Dateien markiert, bereit zum gemeinsamen Ziehen oder Verschieben', 'Abre el Explorador con todos los archivos seleccionados resaltados, listos para arrastrarlos o moverlos juntos', '在资源管理器中打开并选中所有文件,方便一起拖动或移动'],
  'Folders': ['Dossiers', 'Ordner', 'Carpetas', '文件夹'],
  'Remove…': ['Retirer…', 'Entfernen…', 'Quitar…', '移除…'],
  'Remove from Trove, or delete from your computer (Ctrl+click: delete permanently, no confirmation)': ['Retirer de Trove, ou supprimer de votre ordinateur (Ctrl+clic : suppression définitive, sans confirmation)', 'Aus Trove entfernen oder vom Computer löschen (Strg+Klick: endgültig löschen, ohne Nachfrage)', 'Quitar de Trove o borrar del ordenador (Ctrl+clic: borrar para siempre, sin confirmación)', '从 Trove 移除或从电脑删除(Ctrl+点击:永久删除,无需确认)'],
  'Sorted': ['Trié', 'Sortiert', 'Ordenado', '已整理'],
  'Deselect': ['Désélectionner', 'Auswahl aufheben', 'Deseleccionar', '取消选择'],
  'Filter': ['Filtrer', 'Filtern', 'Filtrar', '筛选'],
  'Narrow down the files shown - by type, date, camera, location and more': ['Affinez les fichiers affichés : par type, date, appareil, lieu, etc.', 'Angezeigte Dateien eingrenzen: nach Typ, Datum, Kamera, Ort und mehr', 'Filtra los archivos mostrados: por tipo, fecha, cámara, ubicación y más', '按类型、日期、相机、地点等筛选显示的文件'],
  'Photos': ['Photos', 'Fotos', 'Fotos', '照片'],
  'Videos': ['Vidéos', 'Videos', 'Vídeos', '视频'],
  'Pinned only': ['Épinglés seulement', 'Nur angeheftete', 'Solo fijados', '仅已置顶'],
  'Pin in Folder: keep it at the top of this folder only': ['Épingler dans le dossier : le garder en haut de ce dossier uniquement', 'Im Ordner anheften: nur in diesem Ordner oben halten', 'Fijar en carpeta: mantenerlo arriba solo en esta carpeta', '在文件夹中置顶:仅在此文件夹中保持在最上方'],
  'Edited': ['Retouchées', 'Bearbeitet', 'Editadas', '已编辑'],
  "Photos edited in Trove's own editor": ["Photos retouchées dans l'éditeur de Trove", 'Im Trove-Editor bearbeitete Fotos', 'Fotos editadas en el editor de Trove', '在 Trove 编辑器中编辑过的照片'],
  'Any year': ['Toutes les années', 'Jedes Jahr', 'Cualquier año', '任意年份'],
  'Any device': ['Tous les appareils', 'Jedes Gerät', 'Cualquier dispositivo', '任意设备'],
  'Any location': ['Tous les lieux', 'Jeder Ort', 'Cualquier lugar', '任意地点'],
  'Photos only - by orientation/shape: vertical, horizontal, or a wide panorama': ['Photos uniquement, par orientation : verticale, horizontale ou panorama', 'Nur Fotos, nach Ausrichtung: hoch, quer oder Panorama', 'Solo fotos, por orientación: vertical, horizontal o panorámica', '仅照片,按方向:竖向、横向或全景'],
  'Any image size': ['Toutes les orientations', 'Jedes Format', 'Cualquier formato', '任意方向'],
  'Vertical': ['Verticale', 'Hochformat', 'Vertical', '竖向'],
  'Horizontal': ['Horizontale', 'Querformat', 'Horizontal', '横向'],
  'Panorama': ['Panorama', 'Panorama', 'Panorámica', '全景'],
  'Photos only - by pixel resolution (longer edge)': ['Photos uniquement, par résolution (côté le plus long)', 'Nur Fotos, nach Auflösung (längere Seite)', 'Solo fotos, por resolución (lado más largo)', '仅照片,按分辨率(长边)'],
  'Any resolution': ['Toutes les résolutions', 'Jede Auflösung', 'Cualquier resolución', '任意分辨率'],
  'Under HD': ['Moins que HD', 'Unter HD', 'Menos de HD', '低于 HD'],
  'All': ['Tout', 'Alle', 'Todo', '全部'],
  'Newest first': ["Plus récentes d'abord", 'Neueste zuerst', 'Más recientes primero', '最新优先'],
  'Oldest first': ["Plus anciennes d'abord", 'Älteste zuerst', 'Más antiguas primero', '最早优先'],
  'By trip': ['Par voyage', 'Nach Reise', 'Por viaje', '按旅行'],
  'Export Album': ["Exporter l'album", 'Album exportieren', 'Exportar álbum', '导出相册'],
  'Copies these files (not shortcuts) plus a viewable gallery page into a folder you choose - safe to share with anyone, no Trove required': ["Copie ces fichiers (pas des raccourcis) et une page galerie dans le dossier de votre choix : à partager avec n'importe qui, sans Trove", 'Kopiert diese Dateien (keine Verknüpfungen) und eine Galerieseite in einen Ordner Ihrer Wahl: teilbar mit allen, ohne Trove', 'Copia estos archivos (no accesos directos) y una página de galería en la carpeta que elijas: para compartir con cualquiera, sin Trove', '将这些文件(不是快捷方式)和一个可浏览的相册页面复制到你选择的文件夹:可分享给任何人,无需 Trove'],

  // Grid, empty states, banners
  'VIDEO': ['VIDÉO', 'VIDEO', 'VÍDEO', '视频'],
  'Missing': ['Introuvable', 'Fehlt', 'No encontrado', '缺失'],
  'No results': ['Aucun résultat', 'Keine Ergebnisse', 'Sin resultados', '没有结果'],
  'All sorted - nothing left here!': ['Tout est trié, il ne reste rien ici !', 'Alles sortiert, hier ist nichts mehr!', '¡Todo ordenado, aquí no queda nada!', '全部整理完毕,这里什么都没有了!'],
  "Add a batch of files and Trove auto-sorts them by camera. Files it can't recognise land here for you to sort manually.": ["Ajoutez un lot de fichiers et Trove les trie par appareil. Ceux qu'il ne reconnaît pas arrivent ici pour que vous les triiez.", 'Fügen Sie Dateien hinzu, Trove sortiert sie nach Kamera. Was es nicht erkennt, landet hier zum Sortieren von Hand.', 'Añade un lote de archivos y Trove los ordena por cámara. Los que no reconozca llegan aquí para que los ordenes tú.', '添加一批文件,Trove 会按相机自动整理。无法识别的文件会放在这里,由你手动整理。'],
  'Click to add files, or drag & drop them anywhere': ["Cliquez pour ajouter des fichiers, ou glissez-les n'importe où", 'Klicken, um Dateien hinzuzufügen, oder irgendwo hineinziehen', 'Haz clic para añadir archivos o arrástralos a cualquier parte', '点击添加文件,或拖放到任意位置'],
  'No edited files yet': ["Aucun fichier retouché pour l'instant", 'Noch keine bearbeiteten Dateien', 'Aún no hay archivos editados', '还没有编辑过的文件'],
  "Files you edit in Trove's own editor, or link as an edited version via Sort → Find duplicates & edits, show up here automatically.": ["Les fichiers modifiés dans l'éditeur de Trove, ou liés comme version retouchée via Trier → Doublons et retouches, apparaissent ici automatiquement.", 'Dateien, die Sie im Trove-Editor bearbeiten oder über Sortieren → Duplikate & Bearbeitungen als bearbeitete Version verknüpfen, erscheinen hier automatisch.', 'Los archivos que editas en el editor de Trove, o que enlazas como versión editada en Ordenar → Duplicados y ediciones, aparecen aquí automáticamente.', '在 Trove 编辑器中编辑的文件,或通过“整理 → 查找重复和编辑版本”关联的编辑版本,会自动显示在这里。'],
  'No files here': ['Aucun fichier ici', 'Keine Dateien hier', 'No hay archivos aquí', '这里没有文件'],
  'Drag & drop files or click Add Files': ['Glissez des fichiers ou cliquez sur Ajouter des fichiers', 'Dateien hineinziehen oder auf Dateien hinzufügen klicken', 'Arrastra archivos o haz clic en Añadir archivos', '拖放文件或点击“添加文件”'],
  'camera folders shown on cards are': ['les dossiers appareil affichés sur les cartes sont des', 'die Kameraordner auf den Karten sind', 'las carpetas de cámara de las tarjetas son', '卡片上显示的相机文件夹只是'],
  'suggestions': ['suggestions', 'Vorschläge', 'sugerencias', '建议'],
  'Reassign via Folders, then select all & click': ['Réattribuez via Dossiers, puis sélectionnez tout et cliquez sur', 'Über Ordner neu zuweisen, dann alles auswählen und klicken auf', 'Reasígnalas en Carpetas, luego selecciona todo y haz clic en', '可通过“文件夹”重新分配,然后全选并点击'],
  'Help me sort': ['Aide-moi à trier', 'Hilf mir sortieren', 'Ayúdame a ordenar', '帮我整理'],
  'Smart Match': ['Correspondance intelligente', 'Intelligenter Abgleich', 'Coincidencia inteligente', '智能匹配'],
  "Reviews only the photos it's very confident about, one at a time - learned from how you've already organized your own folders": ["Ne passe en revue que les photos dont il est très sûr, une à une, d'après la façon dont vous avez déjà rangé vos dossiers", 'Zeigt nur die Fotos, bei denen es sich sehr sicher ist, eins nach dem anderen, gelernt daraus, wie Sie Ihre Ordner schon sortiert haben', 'Revisa solo las fotos de las que está muy seguro, una a una, según cómo ya has ordenado tus carpetas', '只逐张检查它非常有把握的照片,依据你已整理的文件夹学习而来'],
  'LIVE': ['LIVE', 'LIVE', 'LIVE', '实况'],
  'No media yet': ["Aucun média pour l'instant", 'Noch keine Medien', 'Aún no hay contenido', '还没有媒体'],
  'Hide files ↑': ['Masquer les fichiers ↑', 'Dateien ausblenden ↑', 'Ocultar archivos ↑', '隐藏文件 ↑'],
  'Matched by visual content, not filename/tags': ['Trouvé par son contenu visuel, pas par le nom ou les étiquettes', 'Über den Bildinhalt gefunden, nicht über Name oder Tags', 'Encontrado por su contenido visual, no por nombre o etiquetas', '按画面内容匹配,而非文件名或标签'],
  'Has a linked original - click to view versions': ["A un original lié : cliquez pour voir les versions", 'Hat ein verknüpftes Original: klicken für Versionen', 'Tiene un original enlazado: haz clic para ver las versiones', '有关联的原图:点击查看版本'],
  'Live Photo - click to play the motion': ['Live Photo : cliquez pour lire le mouvement', 'Live Photo: klicken, um die Bewegung abzuspielen', 'Live Photo: haz clic para reproducir el movimiento', '实况照片:点击播放动态'],
  'Pinned': ['Épinglé', 'Angeheftet', 'Fijado', '已置顶'],
  'Double-click to view full size': ['Double-cliquez pour voir en grand', 'Doppelklick für volle Größe', 'Doble clic para ver a tamaño completo', '双击查看大图'],
  'Edited in Trove': ['Retouchée dans Trove', 'In Trove bearbeitet', 'Editada en Trove', '在 Trove 中编辑'],
  'Edited versions': ['Versions retouchées', 'Bearbeitete Versionen', 'Versiones editadas', '编辑版本'],

  // Preview
  'This video format can\'t be previewed in-app.': ["Ce format vidéo ne peut pas être lu dans l'application.", 'Dieses Videoformat kann in der App nicht abgespielt werden.', 'Este formato de vídeo no se puede ver en la app.', '此视频格式无法在应用内预览。'],
  'Open in default player': ['Ouvrir dans le lecteur par défaut', 'Im Standardplayer öffnen', 'Abrir en el reproductor predeterminado', '用默认播放器打开'],
  'Loading photo': ['Chargement de la photo', 'Foto wird geladen', 'Cargando foto', '正在加载照片'],
  'Click to rename': ['Cliquez pour renommer', 'Zum Umbenennen klicken', 'Haz clic para renombrar', '点击重命名'],
  'Prev': ['Préc.', 'Zurück', 'Anterior', '上一个'],
  'Next': ['Suiv.', 'Weiter', 'Siguiente', '下一个'],
  'Open File': ['Ouvrir le fichier', 'Datei öffnen', 'Abrir archivo', '打开文件'],
  'Edit Props': ['Propriétés', 'Eigenschaften', 'Propiedades', '属性'],
  'Edit Photo': ['Retoucher', 'Foto bearbeiten', 'Editar foto', '编辑照片'],
  'Rotate': ['Pivoter', 'Drehen', 'Girar', '旋转'],
  "Rotate 90° clockwise - only how Trove shows it, the file itself isn't changed (R)": ["Pivoter de 90° dans le sens horaire : seulement l'affichage dans Trove, le fichier n'est pas modifié (R)", 'Um 90° im Uhrzeigersinn drehen: nur die Anzeige in Trove, die Datei bleibt unverändert (R)', 'Girar 90° en sentido horario: solo cómo lo muestra Trove, el archivo no cambia (R)', '顺时针旋转 90°:只改变 Trove 中的显示,文件本身不变(R)'],
  'Grab frame': ["Capturer l'image", 'Bild sichern', 'Capturar fotograma', '截取画面'],
  'Save the current frame as a full-resolution photo, dated to this exact moment (G)': ["Enregistrer l'image affichée comme photo en pleine résolution, datée de cet instant précis (G)", 'Aktuelles Bild als Foto in voller Auflösung speichern, datiert auf genau diesen Moment (G)', 'Guardar el fotograma actual como foto a resolución completa, con la fecha de ese momento (G)', '将当前画面保存为全分辨率照片,日期为该时刻(G)'],
  'Thumbnail ▾': ['Miniature ▾', 'Vorschaubild ▾', 'Miniatura ▾', '缩略图 ▾'],
  "Change this video's thumbnail in the library: use the frame on screen, or import an image (the video file isn't changed)": ["Changer la miniature de cette vidéo dans la bibliothèque : utiliser l'image affichée ou importer une image (le fichier vidéo n'est pas modifié)", 'Vorschaubild dieses Videos ändern: aktuelles Bild verwenden oder ein Bild importieren (die Videodatei bleibt unverändert)', 'Cambiar la miniatura de este vídeo: usar el fotograma en pantalla o importar una imagen (el archivo no cambia)', '更改此视频在库中的缩略图:使用当前画面或导入图片(视频文件不变)'],
  'Use current frame': ["Utiliser l'image affichée", 'Aktuelles Bild verwenden', 'Usar el fotograma actual', '使用当前画面'],
  'Pick a frame from the video…': ['Choisir une image de la vidéo…', 'Bild aus dem Video wählen…', 'Elegir un fotograma del vídeo…', '从视频中选一帧…'],
  'Showing your custom thumbnail': ['Miniature personnalisée affichée', 'Eigenes Vorschaubild wird angezeigt', 'Se muestra tu miniatura personalizada', '正在显示自定义缩略图'],
  'Showing the automatic thumbnail': ['Miniature automatique affichée', 'Automatisches Vorschaubild wird angezeigt', 'Se muestra la miniatura automática', '正在显示自动缩略图'],
  'Scroll to zoom · Drag to pan · Double-click to reset': ['Molette pour zoomer · Glisser pour se déplacer · Double-clic pour réinitialiser', 'Scrollen zum Zoomen · Ziehen zum Verschieben · Doppelklick zum Zurücksetzen', 'Rueda para zoom · Arrastra para moverte · Doble clic para restablecer', '滚动缩放 · 拖动平移 · 双击重置'],

  // Context menus
  'Pin in Folder': ['Épingler dans le dossier', 'Im Ordner anheften', 'Fijar en la carpeta', '在文件夹中置顶'],
  'Unpin': ['Désépingler', 'Lösen', 'Desfijar', '取消置顶'],
  'Keeps this file at the top of THIS folder only - different from Liked, which is a library-wide highlight reel': ["Garde ce fichier en haut de CE dossier uniquement, différent des Coups de cœur, qui valent pour toute la bibliothèque", 'Hält diese Datei nur in DIESEM Ordner oben, anders als Gefällt mir, das für die ganze Bibliothek gilt', 'Mantiene este archivo arriba solo en ESTA carpeta, a diferencia de Me gusta, que vale para toda la biblioteca', '仅在此文件夹中置顶,与适用于整个照片库的“喜欢”不同'],
  'Move to Folder…': ['Déplacer vers un dossier…', 'In Ordner verschieben…', 'Mover a una carpeta…', '移到文件夹…'],
  'Rename': ['Renommer', 'Umbenennen', 'Renombrar', '重命名'],
  'Show in Folder': ["Afficher dans l'explorateur", 'Im Ordner zeigen', 'Mostrar en la carpeta', '在文件夹中显示'],
  'Edit Properties': ['Modifier les propriétés', 'Eigenschaften bearbeiten', 'Editar propiedades', '编辑属性'],
  'Keep the photo and its location, just don\'t show it on the map (or count it toward its trip\'s dot and Relive route)': ["Garder la photo et son lieu, mais ne pas l'afficher sur la carte (ni la compter dans le point et le trajet de son voyage)", 'Foto und Ort behalten, aber nicht auf der Karte zeigen (und nicht für Reisepunkt und Route zählen)', 'Conservar la foto y su ubicación, pero no mostrarla en el mapa (ni contarla en el punto y la ruta de su viaje)', '保留照片及其位置,只是不在地图上显示(也不计入旅行标记和路线)'],
  'Hide from Map': ['Masquer de la carte', 'Auf der Karte ausblenden', 'Ocultar del mapa', '从地图隐藏'],
  'Show on Map': ['Afficher sur la carte', 'Auf der Karte zeigen', 'Mostrar en el mapa', '在地图上显示'],
  'See on Map': ['Voir sur la carte', 'Auf der Karte ansehen', 'Ver en el mapa', '在地图上查看'],
  'Clear Location': ['Effacer le lieu', 'Ort entfernen', 'Borrar ubicación', '清除位置'],
  'Ctrl+click: delete permanently, no confirmation': ['Ctrl+clic : suppression définitive, sans confirmation', 'Strg+Klick: endgültig löschen, ohne Nachfrage', 'Ctrl+clic: borrar para siempre, sin confirmación', 'Ctrl+点击:永久删除,无需确认'],
  'Set Thumbnail…': ['Définir la miniature…', 'Vorschaubild festlegen…', 'Elegir miniatura…', '设置缩略图…'],
  'Set Cover Photo': ['Choisir la photo de couverture', 'Titelbild festlegen', 'Elegir foto de portada', '设置封面照片'],
  'Reset to Auto': ['Revenir en automatique', 'Auf automatisch zurücksetzen', 'Volver a automático', '恢复自动'],
  'New Subfolder': ['Nouveau sous-dossier', 'Neuer Unterordner', 'Nueva subcarpeta', '新建子文件夹'],
  'Customize': ['Personnaliser', 'Anpassen', 'Personalizar', '自定义'],
  'Delete Folder': ['Supprimer le dossier', 'Ordner löschen', 'Eliminar carpeta', '删除文件夹'],
  'Relive Trip': ['Revivre le voyage', 'Reise nacherleben', 'Revivir el viaje', '重温旅行'],
  'Move to Adventures': ['Déplacer vers Aventures', 'Zu Abenteuer verschieben', 'Mover a Aventuras', '移到探险'],
  'Move to Trips': ['Déplacer vers Voyages', 'Zu Reisen verschieben', 'Mover a Viajes', '移到旅行'],

  // Delete / remove dialogs
  'Delete files from disk?': ['Supprimer les fichiers du disque ?', 'Dateien vom Datenträger löschen?', '¿Borrar los archivos del disco?', '从磁盘删除文件?'],
  'This removes the real files from your hard drive - not just the shortcuts.': ['Cela supprime les vrais fichiers de votre disque, pas seulement les raccourcis.', 'Damit werden die echten Dateien von Ihrer Festplatte gelöscht, nicht nur die Verknüpfungen.', 'Esto borra los archivos reales del disco, no solo los accesos directos.', '这会从硬盘删除真实文件,而不只是快捷方式。'],
  'Permanently delete (skip the Recycle Bin)': ['Supprimer définitivement (sans passer par la Corbeille)', 'Endgültig löschen (Papierkorb überspringen)', 'Borrar para siempre (sin pasar por la Papelera)', '永久删除(不放入回收站)'],
  'Unchecked: files go to the Recycle Bin - empty it afterwards to actually free the space.': ["Décoché : les fichiers vont dans la Corbeille. Videz-la ensuite pour vraiment libérer l'espace.", 'Nicht angehakt: Dateien kommen in den Papierkorb. Leeren Sie ihn danach, um den Platz wirklich freizugeben.', 'Sin marcar: los archivos van a la Papelera. Vacíala después para liberar el espacio de verdad.', '不勾选:文件进入回收站,之后清空回收站才能真正释放空间。'],
  'Delete': ['Supprimer', 'Löschen', 'Borrar', '删除'],
  'Deleting…': ['Suppression…', 'Wird gelöscht…', 'Borrando…', '正在删除…'],
  'Remove photos?': ['Retirer les photos ?', 'Fotos entfernen?', '¿Quitar las fotos?', '移除照片?'],
  'Choose what should happen to them.': ['Choisissez ce qui doit leur arriver.', 'Wählen Sie, was mit ihnen geschehen soll.', 'Elige qué hacer con ellas.', '选择如何处理它们。'],
  'Remove from Trove': ['Retirer de Trove', 'Aus Trove entfernen', 'Quitar de Trove', '从 Trove 移除'],
  'Takes the shortcut out of your library. The real file stays exactly where it is on your computer, untouched.': ['Retire le raccourci de votre bibliothèque. Le vrai fichier reste exactement où il est sur votre ordinateur, intact.', 'Entfernt die Verknüpfung aus der Bibliothek. Die echte Datei bleibt unverändert, wo sie auf Ihrem Computer liegt.', 'Quita el acceso directo de tu biblioteca. El archivo real se queda intacto donde está en tu ordenador.', '从照片库中移除快捷方式。真实文件原封不动地保留在电脑上原来的位置。'],
  'Delete from my computer': ['Supprimer de mon ordinateur', 'Von meinem Computer löschen', 'Borrar de mi ordenador', '从电脑中删除'],
  'Two very different things - pick the one you mean.': ['Deux choses très différentes : choisissez celle que vous voulez.', 'Zwei sehr verschiedene Dinge: wählen Sie, was Sie meinen.', 'Dos cosas muy distintas: elige la que quieres.', '这是两件完全不同的事,请选择你想要的。'],
  'Cancel': ['Annuler', 'Abbrechen', 'Cancelar', '取消'],
  'Close': ['Fermer', 'Schließen', 'Cerrar', '关闭'],
  'Save': ['Enregistrer', 'Speichern', 'Guardar', '保存'],
  'Back': ['Retour', 'Zurück', 'Atrás', '返回'],
  'Remove': ['Retirer', 'Entfernen', 'Quitar', '移除'],
  'Loading…': ['Chargement…', 'Wird geladen…', 'Cargando…', '加载中…'],
  'Set': ['Définir', 'Festlegen', 'Fijar', '设置'],
  'Apply': ['Appliquer', 'Anwenden', 'Aplicar', '应用'],
  'Skip': ['Passer', 'Überspringen', 'Saltar', '跳过'],
  'Undo': ['Annuler', 'Rückgängig', 'Deshacer', '撤销'],
  'Redo': ['Rétablir', 'Wiederholen', 'Rehacer', '重做'],
  'Done': ['Terminé', 'Fertig', 'Listo', '完成'],
  'Got it': ["C'est noté", 'Verstanden', 'Entendido', '知道了'],
  "Don't show tips": ['Ne plus afficher les astuces', 'Keine Tipps mehr zeigen', 'No mostrar consejos', '不再显示提示'],
  'Select all': ['Tout sélectionner', 'Alle auswählen', 'Seleccionar todo', '全选'],
  'Empty': ['Vide', 'Leer', 'Vacío', '空'],

  // Folders: assign, new folder, edit properties
  'Assign to Folders': ['Ranger dans des dossiers', 'Ordnern zuweisen', 'Asignar a carpetas', '分配到文件夹'],
  'Select which folders to link this file to': ['Choisissez les dossiers auxquels lier ce fichier', 'Wählen Sie die Ordner für diese Datei', 'Elige las carpetas a las que enlazar este archivo', '选择要关联此文件的文件夹'],
  'Select folders to link selected files to': ['Choisissez les dossiers où ranger les fichiers sélectionnés', 'Ordner für die ausgewählten Dateien wählen', 'Elige las carpetas para los archivos seleccionados', '为所选文件选择文件夹'],
  'New Folder': ['Nouveau dossier', 'Neuer Ordner', 'Nueva carpeta', '新建文件夹'],
  '+ New Folder': ['+ Nouveau dossier', '+ Neuer Ordner', '+ Nueva carpeta', '+ 新建文件夹'],
  'Click, then use your OS emoji picker - Win+. on Windows, Ctrl+Cmd+Space on Mac': ["Cliquez, puis utilisez le sélecteur d'emoji : Win+. sur Windows, Ctrl+Cmd+Espace sur Mac", 'Klicken, dann die Emoji-Auswahl nutzen: Win+. unter Windows, Ctrl+Cmd+Leertaste auf dem Mac', 'Haz clic y usa el selector de emojis: Win+. en Windows, Ctrl+Cmd+Espacio en Mac', '点击后使用系统表情选择器:Windows 按 Win+.,Mac 按 Ctrl+Cmd+空格'],
  'Folder name…': ['Nom du dossier…', 'Ordnername…', 'Nombre de la carpeta…', '文件夹名称…'],
  'Use image as icon': ["Utiliser une image comme icône", 'Bild als Symbol verwenden', 'Usar imagen como icono', '使用图片作为图标'],
  'Remove image': ["Retirer l'image", 'Bild entfernen', 'Quitar imagen', '移除图片'],
  'Parent folder (optional)': ['Dossier parent (facultatif)', 'Übergeordneter Ordner (optional)', 'Carpeta superior (opcional)', '上级文件夹(可选)'],
  '- None (top level) -': ['- Aucun (premier niveau) -', '- Keiner (oberste Ebene) -', '- Ninguna (nivel superior) -', '- 无(顶层)-'],
  'When was this trip? (optional - helps future photo dumps auto-file here)': ['Quand a eu lieu ce voyage ? (facultatif, aide à ranger ici les prochaines photos automatiquement)', 'Wann war diese Reise? (optional, hilft, künftige Fotos automatisch hier abzulegen)', '¿Cuándo fue este viaje? (opcional, ayuda a archivar aquí las próximas fotos automáticamente)', '这趟旅行是什么时候?(可选,有助于以后的照片自动归入这里)'],
  'When was this trip? (optional)': ['Quand a eu lieu ce voyage ? (facultatif)', 'Wann war diese Reise? (optional)', '¿Cuándo fue este viaje? (opcional)', '这趟旅行是什么时候?(可选)'],
  'to': ['au', 'bis', 'al', '至'],
  'Color': ['Couleur', 'Farbe', 'Color', '颜色'],
  'Create': ['Créer', 'Erstellen', 'Crear', '创建'],
  'New person': ['Nouvelle personne', 'Neue Person', 'Nueva persona', '新人物'],
  'New Person': ['Nouvelle personne', 'Neue Person', 'Nueva persona', '新人物'],
  '+ New person': ['+ Nouvelle personne', '+ Neue Person', '+ Nueva persona', '+ 新人物'],
  'Name…': ['Nom…', 'Name…', 'Nombre…', '名字…'],
  'Add categories': ['Ajouter des catégories', 'Kategorien hinzufügen', 'Añadir categorías', '添加分类'],
  'Tap any that apply - you can add more any time.': ["Touchez celles qui conviennent, vous pourrez en ajouter d'autres à tout moment.", 'Tippen Sie alle passenden an, Sie können jederzeit mehr hinzufügen.', 'Toca las que apliquen, puedes añadir más cuando quieras.', '点选适用的分类,之后随时可以再添加。'],
  'Something else?': ['Autre chose ?', 'Etwas anderes?', '¿Algo más?', '还有别的吗?'],
  'Category name…': ['Nom de la catégorie…', 'Kategoriename…', 'Nombre de la categoría…', '分类名称…'],
  'Add custom': ['Ajouter', 'Eigene hinzufügen', 'Añadir propia', '自定义添加'],
  'You already have all the common starter categories.': ['Vous avez déjà toutes les catégories de base.', 'Sie haben bereits alle üblichen Startkategorien.', 'Ya tienes todas las categorías básicas.', '你已经有所有常用的基础分类了。'],
  'Override metadata for this file': ['Remplacer les métadonnées de ce fichier', 'Metadaten dieser Datei überschreiben', 'Sobrescribir los metadatos de este archivo', '覆盖此文件的元数据'],
  'Camera / Device': ['Appareil', 'Kamera / Gerät', 'Cámara / dispositivo', '相机 / 设备'],
  'e.g. GoPro, iPhone 15, Canon R5': ['ex. GoPro, iPhone 15, Canon R5', 'z. B. GoPro, iPhone 15, Canon R5', 'p. ej. GoPro, iPhone 15, Canon R5', '例如 GoPro、iPhone 15、Canon R5'],
  'Date & Time': ['Date et heure', 'Datum & Uhrzeit', 'Fecha y hora', '日期和时间'],
  'GPS Coordinates': ['Coordonnées GPS', 'GPS-Koordinaten', 'Coordenadas GPS', 'GPS 坐标'],
  'Latitude (-90 to 90)': ['Latitude (-90 à 90)', 'Breitengrad (-90 bis 90)', 'Latitud (-90 a 90)', '纬度(-90 到 90)'],
  'Longitude (-180 to 180)': ['Longitude (-180 à 180)', 'Längengrad (-180 bis 180)', 'Longitud (-180 a 180)', '经度(-180 到 180)'],
  'Clear GPS': ['Effacer le GPS', 'GPS entfernen', 'Borrar GPS', '清除 GPS'],
  'Tags': ['Étiquettes', 'Tags', 'Etiquetas', '标签'],
  'e.g. FPV, Drone, Timelapse (comma-separated)': ['ex. FPV, Drone, Timelapse (séparées par des virgules)', 'z. B. FPV, Drohne, Zeitraffer (durch Kommas getrennt)', 'p. ej. FPV, Dron, Timelapse (separadas por comas)', '例如 FPV、无人机、延时(用逗号分隔)'],
  'Notes': ['Notes', 'Notizen', 'Notas', '备注'],
  'Personal notes about this file…': ['Notes personnelles sur ce fichier…', 'Persönliche Notizen zu dieser Datei…', 'Notas personales sobre este archivo…', '关于此文件的个人备注…'],
  'Drop to add shortcuts': ['Déposez pour ajouter des raccourcis', 'Ablegen, um Verknüpfungen hinzuzufügen', 'Suelta para añadir accesos directos', '放下以添加快捷方式'],
  'No copies - originals stay in place': ['Pas de copies : les originaux restent en place', 'Keine Kopien: Originale bleiben, wo sie sind', 'Sin copias: los originales se quedan en su sitio', '不复制:原文件保留在原处'],
  'Custom color…': ['Couleur personnalisée…', 'Eigene Farbe…', 'Color personalizado…', '自定义颜色…'],
  'New Trip': ['Nouveau voyage', 'Neue Reise', 'Nuevo viaje', '新旅行'],
  'New Adventure': ['Nouvelle aventure', 'Neues Abenteuer', 'Nueva aventura', '新探险'],
  'New Camera': ['Nouvel appareil', 'Neue Kamera', 'Nueva cámara', '新相机'],
  '+ New camera': ['+ Nouvel appareil', '+ Neue Kamera', '+ Nueva cámara', '+ 新相机'],
  'All Photos': ['Toutes les photos', 'Alle Fotos', 'Todas las fotos', '所有照片'],

  // Burst, missing files, backups, versions
  'Burst - pick your favorite': ['Rafale : choisissez votre préférée', 'Serienbild: wählen Sie Ihr Lieblingsbild', 'Ráfaga: elige tu favorita', '连拍:选出你最喜欢的'],
  'Keep All': ['Tout garder', 'Alle behalten', 'Conservar todas', '全部保留'],
  'Show All Separately': ['Tout afficher séparément', 'Alle einzeln zeigen', 'Mostrar todas por separado', '分别显示全部'],
  'Keep Only This One': ['Ne garder que celle-ci', 'Nur dieses behalten', 'Conservar solo esta', '只保留这一张'],
  'Favorite': ['Préférée', 'Favorit', 'Favorita', '最爱'],
  'Missing files': ['Fichiers introuvables', 'Fehlende Dateien', 'Archivos no encontrados', '缺失的文件'],
  'Remove All': ['Tout retirer', 'Alle entfernen', 'Quitar todos', '全部移除'],
  'Do This Later': ['Plus tard', 'Später erledigen', 'Hacerlo más tarde', '稍后处理'],
  'Locate…': ['Localiser…', 'Suchen…', 'Localizar…', '定位…'],
  'Backups': ['Sauvegardes', 'Sicherungen', 'Copias de seguridad', '备份'],
  'A snapshot of your library is taken automatically each time you open Trove (and at most every 15 min while you work). Restoring replaces your current library with the chosen snapshot.': ["Un instantané de votre bibliothèque est pris automatiquement à chaque ouverture de Trove (et au plus toutes les 15 min pendant que vous travaillez). Restaurer remplace votre bibliothèque actuelle par l'instantané choisi.", 'Bei jedem Start von Trove (und höchstens alle 15 Minuten während der Arbeit) wird automatisch ein Schnappschuss der Bibliothek erstellt. Wiederherstellen ersetzt die aktuelle Bibliothek durch den gewählten Schnappschuss.', 'Cada vez que abres Trove (y como mucho cada 15 min mientras trabajas) se guarda una instantánea de tu biblioteca. Restaurar sustituye tu biblioteca actual por la instantánea elegida.', '每次打开 Trove 时(工作期间最多每 15 分钟一次)都会自动保存照片库快照。恢复会用所选快照替换当前照片库。'],
  'Loading storage usage…': ["Calcul de l'espace utilisé…", 'Speichernutzung wird geladen…', 'Cargando uso de almacenamiento…', '正在加载存储用量…'],
  'Clean Up Now': ['Nettoyer maintenant', 'Jetzt aufräumen', 'Limpiar ahora', '立即清理'],
  'Open Folder': ['Ouvrir le dossier', 'Ordner öffnen', 'Abrir carpeta', '打开文件夹'],
  'No backups yet - one is taken automatically each time you open Trove.': ['Aucune sauvegarde pour le moment : une est créée à chaque ouverture de Trove.', 'Noch keine Sicherungen: bei jedem Start von Trove wird eine erstellt.', 'Aún no hay copias: se crea una cada vez que abres Trove.', '还没有备份:每次打开 Trove 都会自动创建一个。'],
  'Restore': ['Restaurer', 'Wiederherstellen', 'Restaurar', '恢复'],
  'Link to Original': ["Lier à l'original", 'Mit Original verknüpfen', 'Enlazar con el original', '关联到原图'],
  'Link to original…': ["Lier à l'original…", 'Mit Original verknüpfen…', 'Enlazar con el original…', '关联到原图…'],
  'Search by filename…': ['Rechercher par nom de fichier…', 'Nach Dateiname suchen…', 'Buscar por nombre de archivo…', '按文件名搜索…'],
  'Versions': ['Versions', 'Versionen', 'Versiones', '版本'],
  'The branches of this photo - the original it came from, and any other edits made from that same original.': ["Les branches de cette photo : l'original dont elle vient et les autres retouches faites à partir de cet original.", 'Die Zweige dieses Fotos: das Original, von dem es stammt, und andere Bearbeitungen desselben Originals.', 'Las ramas de esta foto: el original del que viene y las demás ediciones hechas a partir de ese original.', '这张照片的分支:它的原图,以及基于同一原图的其他编辑版本。'],
  'Original vs Edited': ['Original et retouche', 'Original und Bearbeitung', 'Original y editada', '原图与编辑版对比'],
  'Unlink': ['Délier', 'Trennen', 'Desenlazar', '取消关联'],
  'Unlink from its original': ["Délier de son original", 'Vom Original trennen', 'Desenlazar de su original', '取消与原图的关联'],
  'Unlink from this original': ['Délier de cet original', 'Von diesem Original trennen', 'Desenlazar de este original', '取消与此原图的关联'],
  'No matches': ['Aucune correspondance', 'Keine Treffer', 'Sin coincidencias', '没有匹配项'],
  'Try a different search term.': ['Essayez un autre terme.', 'Versuchen Sie einen anderen Suchbegriff.', 'Prueba con otro término.', '换个搜索词试试。'],
  'View larger': ['Voir en grand', 'Größer ansehen', 'Ver más grande', '查看大图'],
  'View full size - double-click also works': ['Voir en grand (le double-clic marche aussi)', 'In voller Größe ansehen (Doppelklick geht auch)', 'Ver a tamaño completo (doble clic también sirve)', '查看大图(双击也可以)'],
  'The one the others get linked to when you keep them all': ['Celle à laquelle les autres sont liées si vous gardez tout', 'Das Bild, mit dem die anderen verknüpft werden, wenn Sie alle behalten', 'La que enlaza a las demás si las conservas todas', '全部保留时,其他版本都会关联到这一张'],
};

// Text with numbers or names in it. $1, $2... are what the pattern captured, kept as is.
const UI_PATTERNS = [
  [/^([\d\s,.]+) selected$/, ['$1 sélectionné(s)', '$1 ausgewählt', '$1 seleccionado(s)', '已选 $1 个']],
  [/^([\d\s,.]+) files? · (.+) in Trove$/, ['$1 fichier(s) · $2 dans Trove', '$1 Datei(en) · $2 in Trove', '$1 archivo(s) · $2 en Trove', '$1 个文件 · Trove 中 $2']],
  [/^Last saved (.+)$/, ['Enregistré à $1', 'Gespeichert um $1', 'Guardado a las $1', '保存于 $1']],
  [/^([\d.,]+ ?[KMGT]?B) freed$/,['$1 libérés', '$1 freigegeben', '$1 liberados', '已释放 $1']],
  [/^(\d+) folders?$/, ['$1 dossier(s)', '$1 Ordner', '$1 carpeta(s)', '$1 个文件夹']],
  [/^Show all files ↓ \((\d+)\)$/, ['Afficher tous les fichiers ↓ ($1)', 'Alle Dateien zeigen ↓ ($1)', 'Mostrar todos los archivos ↓ ($1)', '显示所有文件 ↓($1)']],
  [/^(\d+) files? to review$/, ['$1 fichier(s) à vérifier', '$1 Datei(en) zu prüfen', '$1 archivo(s) por revisar', '$1 个文件待检查']],
  [/^(\d+) of (\d+)$/, ['$1 sur $2', '$1 von $2', '$1 de $2', '$1 / $2']],
  [/^results? for “(.*)”$/, ['résultat(s) pour « $1 »', 'Ergebnis(se) für „$1“', 'resultado(s) para «$1»', '个结果:“$1”']],
  [/^Current: (.+)$/, ['Actuel : $1', 'Aktuell: $1', 'Actual: $1', '当前:$1']],
  [/^Burst of (\d+) - click to pick a favorite$/, ['Rafale de $1 : cliquez pour choisir votre préférée', 'Serie von $1: klicken, um ein Lieblingsbild zu wählen', 'Ráfaga de $1: haz clic para elegir tu favorita', '$1 张连拍:点击选出最爱']],
  [/^Deleted (\d+) files? - (.+) freed$/, ['$1 fichier(s) supprimé(s), $2 libérés', '$1 Datei(en) gelöscht, $2 freigegeben', '$1 archivo(s) borrado(s), $2 liberados', '已删除 $1 个文件,释放 $2']],
  [/^(\d+) files? moved to Recycle Bin \((.+)\) - empty it to free the space$/, ["$1 fichier(s) mis dans la Corbeille ($2) : videz-la pour libérer l'espace", '$1 Datei(en) im Papierkorb ($2): leeren, um Platz freizugeben', '$1 archivo(s) en la Papelera ($2): vacíala para liberar espacio', '$1 个文件已移到回收站($2):清空后才能释放空间']],
  [/^Deleted (\d+) photos - (.+) freed$/, ['$1 photos supprimées, $2 libérés', '$1 Fotos gelöscht, $2 freigegeben', '$1 fotos borradas, $2 liberados', '已删除 $1 张照片,释放 $2']],
  [/^(\d+) photos moved to Recycle Bin \((.+)\) - empty it to free the space$/, ["$1 photos mises dans la Corbeille ($2) : videz-la pour libérer l'espace", '$1 Fotos im Papierkorb ($2): leeren, um Platz freizugeben', '$1 fotos en la Papelera ($2): vacíala para liberar espacio', '$1 张照片已移到回收站($2):清空后才能释放空间']],
  [/^Rotated (\d+) files?$/, ['$1 fichier(s) pivoté(s)', '$1 Datei(en) gedreht', '$1 archivo(s) girado(s)', '已旋转 $1 个文件']],
  [/^Editing (\d+) selected files - changes apply to all of them$/, ['Modification de $1 fichiers sélectionnés : les changements s\'appliquent à tous', '$1 ausgewählte Dateien werden bearbeitet: Änderungen gelten für alle', 'Editando $1 archivos seleccionados: los cambios se aplican a todos', '正在编辑 $1 个所选文件:更改将应用于全部']],
  [/^Part of a burst of (\d+) - folders you pick apply to all (\d+) photos$/, ["Fait partie d'une rafale de $1 : les dossiers choisis s'appliquent aux $2 photos", 'Teil einer Serie von $1: gewählte Ordner gelten für alle $2 Fotos', 'Parte de una ráfaga de $1: las carpetas elegidas se aplican a las $2 fotos', '属于 $1 张连拍:所选文件夹将应用到全部 $2 张照片']],
  [/^(\d+) duplicate groups? · (.+) could be freed$/, ['$1 groupe(s) de doublons · $2 libérables', '$1 Duplikatgruppe(n) · $2 könnten frei werden', '$1 grupo(s) de duplicados · se podrían liberar $2', '$1 组重复项 · 可释放 $2']],
  [/^Will delete (\d+) files? - (.+) freed$/, ['$1 fichier(s) seront supprimés, $2 libérés', '$1 Datei(en) werden gelöscht, $2 frei', 'Se borrarán $1 archivo(s), $2 liberados', '将删除 $1 个文件,释放 $2']],
];

// ── THE ENGINE ───────────────────────────────────────────────────────────────
// Typed text and editable text are never touched; an input's placeholder and title still are.
const UI_SKIP_TEXT = 'script,style,textarea,[contenteditable="true"],[data-no-i18n],#peTextEditor';
const UI_SKIP_ATTR = '[data-no-i18n]';
const uiOrigText = new WeakMap();  // text node -> its English text
const uiSetText = new WeakMap();   // text node -> what we last put in it
const uiOrigAttr = new WeakMap();  // element -> { attr: English }
const uiSetAttr = new WeakMap();   // element -> { attr: what we last put }
const UI_ATTRS = ['title', 'placeholder', 'aria-label'];
let uiExact = null; // English -> translation, for the current language
let uiPatterns = null;

function uiBuildTables() {
  const i = UI_LANG_INDEX[currentLang];
  if (i == null) { uiExact = null; uiPatterns = null; return; }
  uiExact = new Map(Object.entries(UI_TEXT).map(([en, tr]) => [en, tr[i]]));
  uiPatterns = UI_PATTERNS.map(([re, tr]) => [re, tr[i]]);
}

// Exact match first; then the same with leading emoji/symbols and trailing arrows set aside.
function uiTranslate(text) {
  if (!uiExact) return null;
  const trimmed = text.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
  const lead = text.slice(0, text.indexOf(trimmed)), trail = text.slice(text.indexOf(trimmed) + trimmed.length);
  const whole = uiLookup(trimmed);
  if (whole != null) return lead + whole + trail;
  const m = trimmed.match(/^([^A-Za-z0-9(“"'¿¡+-]*)([\s\S]*?)([\s→←↑↓▾›‹…:]*)$/);
  if (!m || !m[2] || (!m[1] && !m[3])) return null;
  // "Link to original…" may be listed with its ellipsis or without it.
  const withTail = uiLookup((m[2] + m[3]).trim());
  if (withTail != null) return lead + m[1] + withTail + trail;
  const core = uiLookup(m[2]);
  return core == null ? null : lead + m[1] + core + m[3] + trail;
}
// A pattern's translation is a string with $1, $2..., or a function given the captured parts
// (to translate a part too, like a Guided Sort step title). Text made of parts joined by ' · '
// is translated part by part: before the patterns when every part is known (so a pattern for
// one part can't swallow the whole line), after them when only some are.
function uiLookup(s) {
  const hit = uiExact.get(s);
  if (hit != null) return hit;
  const parts = s.includes(' · ') ? s.split(' · ') : null;
  const done = parts && parts.map(p => uiTranslate(p));
  const known = (p, i) => done[i] != null || !/[A-Za-z]/.test(parts[i]);
  if (parts && parts.every(known)) return done.map((p, i) => p ?? parts[i]).join(' · ');
  for (const [re, tr] of uiPatterns) {
    const m = s.match(re);
    if (m) return typeof tr === 'function' ? tr(m) : s.replace(re, tr);
  }
  if (parts && done.some(p => p != null)) return done.map((p, i) => p ?? parts[i]).join(' · ');
  return null;
}
// For pattern functions: a captured part in the current language, or as it was.
function uiPart(s) { return uiTranslate(s) ?? s; }

function uiSkip(el, sel = UI_SKIP_TEXT) { return !el || !!el.closest?.(sel); }

function uiDoText(node) {
  if (uiSkip(node.parentElement)) return;
  const now = node.nodeValue;
  // Anything the app wrote since our last pass is the new English original.
  if (uiSetText.get(node) !== now) uiOrigText.set(node, now);
  const orig = uiOrigText.get(node);
  const tr = uiTranslate(orig);
  const want = tr == null ? orig : tr;
  if (now !== want) node.nodeValue = want;
  uiSetText.set(node, want);
}
function uiDoAttrs(el) {
  if (uiSkip(el, UI_SKIP_ATTR)) return;
  for (const a of UI_ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const now = el.getAttribute(a);
    const orig = uiOrigAttr.get(el) || {}, set = uiSetAttr.get(el) || {};
    if (set[a] !== now) { orig[a] = now; uiOrigAttr.set(el, orig); }
    const tr = uiTranslate(orig[a]);
    const want = tr == null ? orig[a] : tr;
    if (now !== want) el.setAttribute(a, want);
    set[a] = want; uiSetAttr.set(el, set);
  }
}
function uiDoTree(root) {
  if (root.nodeType === 3) { uiDoText(root); return; }
  if (root.nodeType !== 1 || uiSkip(root, UI_SKIP_ATTR)) return;
  uiDoAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) uiDoText(n); else uiDoAttrs(n);
  }
}

let uiObserver = null;
function uiI18nStart() {
  uiBuildTables();
  uiDoTree(document.body);
  if (uiObserver) return;
  uiObserver = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(uiDoTree);
      else if (r.type === 'characterData') uiDoText(r.target);
      else if (r.type === 'attributes') uiDoAttrs(r.target);
    }
  });
  uiObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: UI_ATTRS });
}
// After a language change: everything goes back through from its English original.
function uiI18nRefresh() {
  uiBuildTables();
  uiDoTree(document.body);
}

// Texts written in renderer.js / faceIndex.js / globe.js / viewer360.js templates and messages.
Object.assign(UI_TEXT, {
  // Guided Sort
  'Guided Sort': ['Tri guidé', 'Geführtes Sortieren', 'Orden guiado', '引导整理'],
  'Nothing left here': ['Plus rien ici', 'Hier ist nichts mehr', 'No queda nada aquí', '这里什么都没有了'],
  'The photos in this batch': ['Les photos de ce lot', 'Die Fotos dieses Stapels', 'Las fotos de este lote', '这批照片'],
  'Continue →': ['Continuer →', 'Weiter →', 'Continuar →', '继续 →'],
  '+ New trip': ['+ Nouveau voyage', '+ Neue Reise', '+ Nuevo viaje', '+ 新旅行'],
  '+ New adventure': ['+ Nouvelle aventure', '+ Neues Abenteuer', '+ Nueva aventura', '+ 新探险'],
  'matches these photos': ['correspond à ces photos', 'passt zu diesen Fotos', 'coincide con estas fotos', '与这些照片匹配'],
  'Add to trip or adventure…': ['Ajouter à un voyage ou une aventure…', 'Zu Reise oder Abenteuer hinzufügen…', 'Añadir a un viaje o aventura…', '添加到旅行或探险…'],
  'Add to trip or adventure… ▾': ['Ajouter à un voyage ou une aventure… ▾', 'Zu Reise oder Abenteuer hinzufügen… ▾', 'Añadir a un viaje o aventura… ▾', '添加到旅行或探险… ▾'],
  ', or add dates to it from the sidebar (right-click › Customize) for next time.': [", ou ajoutez-lui des dates depuis la barre latérale (clic droit › Personnaliser) pour la prochaine fois.", ', oder geben Sie ihr in der Seitenleiste Daten (Rechtsklick › Anpassen) für das nächste Mal.', ', o añádele fechas desde la barra lateral (clic derecho › Personalizar) para la próxima vez.', ',或在侧边栏为它添加日期(右键 › 自定义),方便下次使用。'],
  'All sorted into trips and adventures': ['Tout est rangé dans des voyages et aventures', 'Alles in Reisen und Abenteuer sortiert', 'Todo ordenado en viajes y aventuras', '已全部归入旅行和探险'],
  'You picked': ['Vous avez choisi', 'Sie haben gewählt', 'Has elegido', '你选择了'],
  'Other trips': ['Autres voyages', 'Andere Reisen', 'Otros viajes', '其他旅行'],
  'Other adventures': ['Autres aventures', 'Andere Abenteuer', 'Otras aventuras', '其他探险'],
  "Pick a person, then click every photo they're in - click again to take one back out. Or select photos first and then tap the person. Double-click a photo to see it larger.": ["Choisissez une personne, puis cliquez sur chaque photo où elle apparaît (recliquez pour l'enlever). Ou sélectionnez d'abord les photos, puis touchez la personne. Double-cliquez sur une photo pour l'agrandir.", 'Wählen Sie eine Person und klicken Sie dann auf jedes Foto mit ihr (nochmals klicken zum Entfernen). Oder erst Fotos auswählen und dann die Person antippen. Doppelklick vergrößert ein Foto.', 'Elige una persona y haz clic en cada foto en la que aparece (otro clic la quita). O selecciona primero las fotos y luego toca a la persona. Doble clic para verla más grande.', '选一个人,然后点击有他的每张照片(再点一次可取消)。也可以先选照片再点人物。双击照片可放大查看。'],
  'Done with people →': ['Fini pour les personnes →', 'Fertig mit Personen →', 'Listo con las personas →', '人物完成 →'],
  'Tagging': ['Étiquetage de', 'Markieren:', 'Etiquetando a', '正在标记'],
  'click photos to add or remove ·': ['cliquez sur les photos pour ajouter ou retirer ·', 'Fotos anklicken zum Hinzufügen oder Entfernen ·', 'haz clic en las fotos para añadir o quitar ·', '点击照片以添加或移除 ·'],
  'Stop': ['Arrêter', 'Stopp', 'Parar', '停止'],
  "Trove can spot who's in these photos and suggest them for you. It runs only on this computer, nothing is uploaded.": ["Trove peut repérer qui est sur ces photos et vous le proposer. Tout se fait sur cet ordinateur, rien n'est envoyé.", 'Trove kann erkennen, wer auf diesen Fotos ist, und es vorschlagen. Alles läuft nur auf diesem Computer, nichts wird hochgeladen.', 'Trove puede detectar quién aparece en estas fotos y sugerirlo. Todo funciona en este ordenador, no se sube nada.', 'Trove 可以识别照片中的人物并给出建议。全部在这台电脑上运行,不会上传任何内容。'],
  'Turn on face recognition': ['Activer la reconnaissance des visages', 'Gesichtserkennung einschalten', 'Activar el reconocimiento facial', '开启人脸识别'],
  'Not now': ['Pas maintenant', 'Nicht jetzt', 'Ahora no', '暂不'],
  'Who is this?': ['Qui est-ce ?', 'Wer ist das?', '¿Quién es?', '这是谁?'],
  "Don't tag": ['Ne pas étiqueter', 'Nicht markieren', 'No etiquetar', '不标记'],
  'Ask later': ['Demander plus tard', 'Später fragen', 'Preguntar más tarde', '稍后再问'],
  'Anything else to file? Open': ['Autre chose à ranger ? Ouvrez', 'Noch etwas abzulegen? Öffnen Sie', '¿Algo más que archivar? Abre', '还有要归档的吗?打开'],
  'Add to folder': ['Ajouter à un dossier', 'Zu Ordner hinzufügen', 'Añadir a carpeta', '添加到文件夹'],
  'to see all your folders, pick one, then click the photos that go in it (or': ['pour voir tous vos dossiers, choisissez-en un, puis cliquez sur les photos qui y vont (ou', 'um alle Ordner zu sehen, wählen Sie einen und klicken Sie auf die Fotos, die hineingehören (oder', 'para ver todas tus carpetas, elige una y haz clic en las fotos que van en ella (o', '查看所有文件夹,选一个,然后点击要放进去的照片(或'],
  'Add all': ['Tout ajouter', 'Alle hinzufügen', 'Añadir todas', '全部添加'],
  '). You can also select photos first and then pick the folder.': ["). Vous pouvez aussi sélectionner d'abord les photos, puis choisir le dossier.", '). Sie können auch erst Fotos auswählen und dann den Ordner wählen.', '). También puedes seleccionar primero las fotos y luego elegir la carpeta.', ')。也可以先选照片再选文件夹。'],
  'Done with folders →': ['Fini pour les dossiers →', 'Fertig mit Ordnern →', 'Listo con las carpetas →', '文件夹完成 →'],
  'Add to folder ▾': ['Ajouter à un dossier ▾', 'Zu Ordner hinzufügen ▾', 'Añadir a carpeta ▾', '添加到文件夹 ▾'],
  'Remove all': ['Tout retirer', 'Alle entfernen', 'Quitar todo', '全部移除'],
  'Click photos to add or remove them': ['Cliquez sur les photos pour les ajouter ou les retirer', 'Fotos anklicken zum Hinzufügen oder Entfernen', 'Haz clic en las fotos para añadirlas o quitarlas', '点击照片以添加或移除'],
  'No folder picked yet': ['Aucun dossier choisi', 'Noch kein Ordner gewählt', 'Aún no has elegido carpeta', '还没有选择文件夹'],
  'Other folders': ['Autres dossiers', 'Andere Ordner', 'Otras carpetas', '其他文件夹'],
  'Your folders': ['Vos dossiers', 'Ihre Ordner', 'Tus carpetas', '你的文件夹'],
  'number = photos from this batch already in it': ['nombre = photos de ce lot déjà dedans', 'Zahl = Fotos aus diesem Stapel, die schon drin sind', 'número = fotos de este lote que ya están dentro', '数字 = 本批中已在其中的照片数'],
  'Skip / Continue →': ['Passer / Continuer →', 'Überspringen / Weiter →', 'Saltar / Continuar →', '跳过 / 继续 →'],
  "Looking for photos that match your existing categories, and grouping whatever's left by what's visually similar.": ['Recherche des photos qui correspondent à vos catégories, et regroupement du reste par ressemblance visuelle.', 'Suche nach Fotos, die zu Ihren Kategorien passen, und Gruppierung des Rests nach optischer Ähnlichkeit.', 'Buscando fotos que encajen con tus categorías y agrupando el resto por parecido visual.', '正在查找符合现有分类的照片,并按视觉相似度对其余照片分组。'],
  'Nothing confident enough to suggest': ["Rien d'assez sûr à suggérer", 'Nichts sicher genug für einen Vorschlag', 'Nada lo bastante seguro para sugerir', '没有足够把握的建议'],
  'Click a photo to leave it out of this suggestion. Double-click or 🔍 to see it larger.': ["Cliquez sur une photo pour la retirer de cette suggestion. Double-cliquez ou 🔍 pour l'agrandir.", 'Klicken Sie ein Foto an, um es aus dem Vorschlag zu nehmen. Doppelklick oder 🔍 zum Vergrößern.', 'Haz clic en una foto para quitarla de esta sugerencia. Doble clic o 🔍 para verla más grande.', '点击照片可将其排除在此建议之外。双击或点 🔍 可放大查看。'],
  'Set Location': ['Définir le lieu', 'Ort festlegen', 'Fijar ubicación', '设置位置'],
  'Skip / Finish →': ['Passer / Terminer →', 'Überspringen / Fertig →', 'Saltar / Terminar →', '跳过 / 完成 →'],
  'All done!': ['Tout est fait !', 'Alles erledigt!', '¡Todo listo!', '全部完成!'],
  'Leave in To Sort': ['Laisser dans À trier', 'In Zu sortieren lassen', 'Dejar en Por ordenar', '留在待整理'],
  'Mark batch as sorted': ['Marquer le lot comme trié', 'Stapel als sortiert markieren', 'Marcar el lote como ordenado', '将这批标记为已整理'],
  "Suggested from how you've already sorted similar photos - tap to add or remove.": ["Suggéré d'après la façon dont vous avez rangé des photos similaires : touchez pour ajouter ou retirer.", 'Vorgeschlagen anhand ähnlicher Fotos, die Sie schon sortiert haben: tippen zum Hinzufügen oder Entfernen.', 'Sugerido según cómo ya ordenaste fotos parecidas: toca para añadir o quitar.', '根据你整理相似照片的方式建议:点击添加或移除。'],
  'Confirm & Next →': ['Confirmer et suivant →', 'Bestätigen & weiter →', 'Confirmar y siguiente →', '确认并下一张 →'],
  'Suggested': ['Suggéré', 'Vorgeschlagen', 'Sugerido', '建议'],
  'Has GPS': ['A un GPS', 'Hat GPS', 'Tiene GPS', '有 GPS'],
  'Skip the trip steps': ['Passer les étapes de voyage', 'Reiseschritte überspringen', 'Saltar los pasos del viaje', '跳过旅行步骤'],
  'Not the same person? Click to take this one out': ["Pas la même personne ? Cliquez pour l'enlever", 'Nicht dieselbe Person? Klicken, um sie herauszunehmen', '¿No es la misma persona? Haz clic para quitarla', '不是同一个人?点击移除'],
  'Their name…': ['Son nom…', 'Name…', 'Su nombre…', '名字…'],
  'Their name': ['Son nom', 'Name', 'Su nombre', '名字'],
  'Nobody to tag - a stranger, a poster, a statue': ['Personne à étiqueter : un inconnu, une affiche, une statue', 'Niemand zu markieren: ein Fremder, ein Plakat, eine Statue', 'Nadie que etiquetar: un desconocido, un póster, una estatua', '无需标记:陌生人、海报、雕像'],
  "That's a big batch - Guided Sort will group it by trip automatically. Tip: adding one trip's photos at a time keeps sorting quick.": ["C'est un gros lot : le Tri guidé va le regrouper par voyage automatiquement. Astuce : ajouter les photos d'un voyage à la fois rend le tri rapide.", 'Das ist ein großer Stapel: Geführtes Sortieren gruppiert ihn automatisch nach Reise. Tipp: Fotos einer Reise auf einmal hinzuzufügen hält das Sortieren schnell.', 'Es un lote grande: el Orden guiado lo agrupará por viaje automáticamente. Consejo: añadir las fotos de un viaje cada vez agiliza el orden.', '这批照片很多:引导整理会自动按旅行分组。提示:每次只添加一趟旅行的照片会更快。'],
  'Select photos on the left, then click the globe to drop a pin for them': ['Sélectionnez des photos à gauche, puis cliquez sur le globe pour y placer une épingle', 'Fotos links auswählen, dann auf den Globus klicken, um eine Markierung zu setzen', 'Selecciona fotos a la izquierda y haz clic en el globo para poner un marcador', '在左侧选择照片,然后点击地球放置标记'],
  'Click anywhere on the globe to place the marker, then confirm': ["Cliquez n'importe où sur le globe pour placer le repère, puis confirmez", 'Irgendwo auf den Globus klicken, um die Markierung zu setzen, dann bestätigen', 'Haz clic en cualquier punto del globo para poner el marcador y confirma', '点击地球任意位置放置标记,然后确认'],

  // Duplicates & Edits, bursts
  'Duplicates & Edits': ['Doublons et retouches', 'Duplikate & Bearbeitungen', 'Duplicados y ediciones', '重复项和编辑版本'],
  'Looking for duplicates & edits…': ['Recherche des doublons et retouches…', 'Suche nach Duplikaten & Bearbeitungen…', 'Buscando duplicados y ediciones…', '正在查找重复项和编辑版本…'],
  'Comparing pixel structure and colour (and, for videos, duration), then filenames, dates and places to spot edited versions - this can take a moment for large libraries.': ['Comparaison de la structure et des couleurs (et de la durée pour les vidéos), puis des noms, dates et lieux pour repérer les retouches : cela peut prendre un moment pour les grosses bibliothèques.', 'Vergleich von Bildstruktur und Farbe (bei Videos auch Dauer), dann Dateinamen, Daten und Orten, um bearbeitete Versionen zu finden: bei großen Bibliotheken kann das dauern.', 'Comparando estructura y color (y duración en vídeos), luego nombres, fechas y lugares para detectar versiones editadas: puede tardar en bibliotecas grandes.', '正在比较像素结构和颜色(视频还比较时长),再比对文件名、日期和地点以找出编辑版本:大型照片库可能需要一点时间。'],
  'No duplicates or edits found': ['Aucun doublon ni retouche trouvé', 'Keine Duplikate oder Bearbeitungen gefunden', 'No se encontraron duplicados ni ediciones', '没有找到重复项或编辑版本'],
  'No photo or video is in your library twice, and every edited version Trove can spot is already linked to its original. You can always link one by hand from its photo view.': ["Aucune photo ou vidéo n'est en double, et chaque retouche repérable est déjà liée à son original. Vous pouvez toujours en lier une à la main depuis sa vue photo.", 'Kein Foto oder Video ist doppelt, und jede erkennbare Bearbeitung ist schon mit ihrem Original verknüpft. Sie können jederzeit eine von Hand in der Fotoansicht verknüpfen.', 'Ninguna foto o vídeo está repetido y cada versión editada detectable ya está enlazada a su original. Siempre puedes enlazar una a mano desde su vista.', '照片库中没有重复的照片或视频,能识别的编辑版本都已关联到原图。你也可以在照片视图中手动关联。'],
  'Scan again': ['Analyser à nouveau', 'Erneut prüfen', 'Volver a analizar', '重新扫描'],
  'An edit and the shot it came from. Link them to keep both with only the edit showing in your library, or delete the one you don\'t need. Cards marked "name" are certain: the file names say which is the edit.': ["Une retouche et la photo d'origine. Liez-les pour garder les deux en n'affichant que la retouche, ou supprimez celle dont vous n'avez pas besoin. Les cartes marquées « nom » sont certaines : les noms de fichiers indiquent la retouche.", 'Eine Bearbeitung und das Foto, aus dem sie stammt. Verknüpfen Sie sie, um beide zu behalten und nur die Bearbeitung zu zeigen, oder löschen Sie das überflüssige. Mit „Name“ markierte Karten sind sicher: die Dateinamen verraten die Bearbeitung.', 'Una edición y la foto de la que sale. Enlázalas para conservar ambas mostrando solo la edición, o borra la que no necesites. Las tarjetas marcadas «nombre» son seguras: los nombres indican cuál es la edición.', '一张编辑版和它的原图。关联后两者都保留,库中只显示编辑版;也可以删除不需要的那张。标有“名称”的卡片是确定的:文件名表明了哪张是编辑版。'],
  'The same picture more than once. Delete the extra copies, or keep them all and link them as versions of one original.': ["La même image plusieurs fois. Supprimez les copies en trop, ou gardez-les toutes en les liant comme versions d'un même original.", 'Dasselbe Bild mehrfach. Löschen Sie die überzähligen Kopien oder behalten Sie alle als Versionen eines Originals.', 'La misma imagen varias veces. Borra las copias sobrantes o consérvalas todas enlazadas como versiones de un original.', '同一张图片出现多次。删除多余副本,或全部保留并关联为同一原图的版本。'],
  'Not a match - ignore': ['Pas une correspondance : ignorer', 'Kein Treffer: ignorieren', 'No coinciden: ignorar', '不匹配:忽略'],
  'Delete unselected': ['Supprimer les non sélectionnées', 'Nicht ausgewählte löschen', 'Borrar las no seleccionadas', '删除未选中的'],
  'a total of': ['soit un total de', 'insgesamt', 'un total de', '共计'],
  'from this burst - a total of': ['de cette rafale, soit un total de', 'aus dieser Serie, insgesamt', 'de esta ráfaga, un total de', '来自此连拍,共计'],
  'Play Live Photo': ['Lire la Live Photo', 'Live Photo abspielen', 'Reproducir Live Photo', '播放实况照片'],
  '360° media': ['Médias 360°', '360°-Medien', 'Contenido 360°', '360° 媒体'],
  'Find new people': ['Trouver de nouvelles personnes', 'Neue Personen finden', 'Encontrar personas nuevas', '查找新人物'],

  // People (face recognition)
  'Looking for the people in your photos…': ['Recherche des personnes sur vos photos…', 'Suche nach den Personen auf Ihren Fotos…', 'Buscando a las personas de tus fotos…', '正在查找照片中的人物…'],
  'Finding everyone in your photos…': ['Recherche de tout le monde sur vos photos…', 'Alle Personen auf Ihren Fotos werden gesucht…', 'Buscando a todo el mundo en tus fotos…', '正在找出照片中的所有人…'],
  'Find the people in your photos': ['Trouvez les personnes sur vos photos', 'Finden Sie die Personen auf Ihren Fotos', 'Encuentra a las personas de tus fotos', '找出照片中的人物'],
  "Trove learns who is who from the People folders you already have, then finds those people in the rest of your photos and files them under their names. It only asks about faces it doesn't recognise.": ["Trove apprend qui est qui grâce à vos dossiers Personnes, puis retrouve ces personnes sur le reste de vos photos et les range à leur nom. Il ne vous interroge que sur les visages qu'il ne reconnaît pas.", 'Trove lernt aus Ihren Personen-Ordnern, wer wer ist, findet diese Personen auf Ihren übrigen Fotos und legt sie unter ihrem Namen ab. Es fragt nur nach Gesichtern, die es nicht erkennt.', 'Trove aprende quién es quién a partir de tus carpetas de Personas, luego encuentra a esas personas en el resto de tus fotos y las archiva con su nombre. Solo pregunta por las caras que no reconoce.', 'Trove 根据你已有的人物文件夹学习谁是谁,然后在其余照片中找到这些人并按名字归档。它只会询问不认识的面孔。'],
  'It runs entirely on this computer. No photo or face ever leaves it.': ["Tout se fait sur cet ordinateur. Aucune photo ni aucun visage n'en sort.", 'Alles läuft auf diesem Computer. Kein Foto und kein Gesicht verlässt ihn.', 'Funciona por completo en este ordenador. Ninguna foto ni cara sale de él.', '完全在这台电脑上运行,任何照片或面孔都不会离开它。'],
  "It only files a photo when it's sure. Close calls are asked, never guessed.": ["Il ne range une photo que s'il est sûr. En cas de doute, il demande, il ne devine jamais.", 'Es legt ein Foto nur ab, wenn es sicher ist. Bei Zweifeln fragt es, statt zu raten.', 'Solo archiva una foto cuando está seguro. Si duda, pregunta; nunca adivina.', '只有确定时才会归档照片。拿不准时会询问,绝不猜测。'],
  'Anything it got wrong is one click to undo, and it remembers the correction.': ["Une erreur s'annule en un clic, et il retient la correction.", 'Jeder Fehler ist mit einem Klick rückgängig, und es merkt sich die Korrektur.', 'Cualquier error se deshace con un clic y recuerda la corrección.', '任何错误都可以一键撤销,它会记住你的更正。'],
  'Switch it off any time in Settings, and every bit of face data is deleted.': ['Désactivez-le à tout moment dans les Paramètres, et toutes les données de visages sont supprimées.', 'Jederzeit in den Einstellungen abschaltbar, dann werden alle Gesichtsdaten gelöscht.', 'Desactívalo cuando quieras en Ajustes y se borran todos los datos de caras.', '随时可在设置中关闭,所有人脸数据都会被删除。'],
  'Check who Trove recognised': ['Vérifier qui Trove a reconnu', 'Prüfen, wen Trove erkannt hat', 'Comprobar a quién reconoció Trove', '查看 Trove 识别出的人'],
  'Scan all photos again': ['Réanalyser toutes les photos', 'Alle Fotos erneut prüfen', 'Volver a analizar todas las fotos', '重新扫描所有照片'],
  'Show more': ['Afficher plus', 'Mehr zeigen', 'Mostrar más', '显示更多'],
  'No, someone else': ["Non, quelqu'un d'autre", 'Nein, jemand anderes', 'No, otra persona', '不,是别人'],
  'Add to People': ['Ajouter aux Personnes', 'Zu Personen hinzufügen', 'Añadir a Personas', '添加到人物'],
  'Not needed': ['Inutile', 'Nicht nötig', 'No hace falta', '不需要'],
  'Check': ['Vérifier', 'Prüfen', 'Comprobar', '检查'],
  'Recognised': ['Reconnu', 'Erkannt', 'Reconocido', '已识别'],
  'Face recognition is off, and its face data has been deleted': ['La reconnaissance des visages est désactivée et ses données ont été supprimées', 'Die Gesichtserkennung ist aus, ihre Daten wurden gelöscht', 'El reconocimiento facial está desactivado y sus datos se han borrado', '人脸识别已关闭,其数据已删除'],
  'Face recognition is on. Trove is looking through your photos in the background': ['La reconnaissance des visages est activée. Trove parcourt vos photos en arrière-plan', 'Die Gesichtserkennung ist an. Trove sieht Ihre Fotos im Hintergrund durch', 'El reconocimiento facial está activado. Trove revisa tus fotos en segundo plano', '人脸识别已开启。Trove 正在后台查看你的照片'],
  'Look through every photo again for faces the first scan missed. Names and corrections are kept.': ['Repasser toutes les photos pour trouver les visages manqués la première fois. Les noms et corrections sont conservés.', 'Alle Fotos erneut nach Gesichtern durchsuchen, die beim ersten Mal übersehen wurden. Namen und Korrekturen bleiben erhalten.', 'Revisar de nuevo todas las fotos en busca de caras que se escaparon. Se conservan nombres y correcciones.', '重新查看所有照片,找出第一次遗漏的面孔。名字和更正都会保留。'],
  'Not someone to add - stop suggesting this face': ['Personne à ajouter : ne plus suggérer ce visage', 'Niemand zum Hinzufügen: dieses Gesicht nicht mehr vorschlagen', 'No hay que añadirla: dejar de sugerir esta cara', '无需添加:不再推荐这张面孔'],
  'Looking for everyone…': ['Recherche de tout le monde…', 'Alle werden gesucht…', 'Buscando a todos…', '正在查找所有人…'],
  'Looking through your photos for faces. It keeps going if you switch to something else.': ['Recherche de visages dans vos photos. Cela continue si vous passez à autre chose.', 'Ihre Fotos werden nach Gesichtern durchsucht. Das läuft weiter, auch wenn Sie etwas anderes tun.', 'Buscando caras en tus fotos. Sigue aunque cambies a otra cosa.', '正在照片中查找面孔。切换到别的操作也会继续。'],
  'Face recognition in People': ['Reconnaissance des visages dans Personnes', 'Gesichtserkennung in Personen', 'Reconocimiento facial en Personas', '人物中的人脸识别'],
  'Finds faces in your photos and groups the ones that look alike, so you can name them and file every photo of someone at once. Runs only on this computer and never files anything without you. Turning it off deletes all face data; People folders stay.': ["Trouve les visages sur vos photos et regroupe ceux qui se ressemblent, pour les nommer et ranger toutes les photos d'une personne d'un coup. Fonctionne uniquement sur cet ordinateur et ne range rien sans vous. Le désactiver supprime toutes les données de visages ; les dossiers Personnes restent.", 'Findet Gesichter auf Ihren Fotos und gruppiert ähnliche, damit Sie sie benennen und alle Fotos einer Person auf einmal ablegen können. Läuft nur auf diesem Computer und legt nichts ohne Sie ab. Abschalten löscht alle Gesichtsdaten; Personen-Ordner bleiben.', 'Encuentra caras en tus fotos y agrupa las que se parecen, para ponerles nombre y archivar todas las fotos de alguien de una vez. Funciona solo en este ordenador y nunca archiva nada sin ti. Al desactivarlo se borran los datos de caras; las carpetas de Personas se quedan.', '在照片中查找面孔并将相似的分组,方便你命名并一次归档某人的所有照片。只在这台电脑上运行,不经你确认绝不归档。关闭后会删除所有人脸数据,人物文件夹保留。'],

  // Globe & Relive
  'All photos ▾': ['Toutes les photos ▾', 'Alle Fotos ▾', 'Todas las fotos ▾', '所有照片 ▾'],
  'Choose which photos show on the map': ['Choisir les photos affichées sur la carte', 'Wählen, welche Fotos auf der Karte erscheinen', 'Elige qué fotos aparecen en el mapa', '选择地图上显示哪些照片'],
  '3D Terrain: Off': ['Relief 3D : désactivé', '3D-Gelände: aus', 'Relieve 3D: desactivado', '3D 地形:关'],
  '3D Terrain: On': ['Relief 3D : activé', '3D-Gelände: an', 'Relieve 3D: activado', '3D 地形:开'],
  'Real elevation data (mountains, valleys) instead of a flat globe. Costs extra GPU/network - turn off if the globe feels laggy.': ["Vrai relief (montagnes, vallées) au lieu d'un globe plat. Demande plus de GPU et de réseau : désactivez-le si le globe rame.", 'Echte Höhendaten (Berge, Täler) statt eines flachen Globus. Kostet mehr GPU und Netzwerk: abschalten, wenn der Globus ruckelt.', 'Relieve real (montañas, valles) en vez de un globo plano. Consume más GPU y red: desactívalo si el globo va lento.', '使用真实海拔数据(山脉、山谷)而非平面地球。会占用更多 GPU 和网络,如果卡顿请关闭。'],
  'Previous trip': ['Voyage précédent', 'Vorherige Reise', 'Viaje anterior', '上一趟旅行'],
  'Next trip': ['Voyage suivant', 'Nächste Reise', 'Viaje siguiente', '下一趟旅行'],
  'No GPS data found.': ['Aucune donnée GPS trouvée.', 'Keine GPS-Daten gefunden.', 'No se encontraron datos GPS.', '没有找到 GPS 数据。'],
  'Add photos/videos with location enabled.': ['Ajoutez des photos ou vidéos avec la localisation activée.', 'Fügen Sie Fotos/Videos mit aktivierter Ortung hinzu.', 'Añade fotos o vídeos con la ubicación activada.', '添加开启了定位的照片或视频。'],
  'Previous day': ['Jour précédent', 'Vorheriger Tag', 'Día anterior', '前一天'],
  'Next day': ['Jour suivant', 'Nächster Tag', 'Día siguiente', '后一天'],
  'Exit': ['Quitter', 'Beenden', 'Salir', '退出'],
  'Show on the map': ['Afficher sur la carte', 'Auf der Karte zeigen', 'Mostrar en el mapa', '在地图上显示'],
  'Hidden from the map': ['Masquées de la carte', 'Auf der Karte ausgeblendet', 'Ocultas en el mapa', '已从地图隐藏'],
  'Show all again': ['Tout réafficher', 'Alle wieder zeigen', 'Mostrar todo de nuevo', '重新全部显示'],
  'Right-click a photo on the map to hide it - handy for a stray photo far from the rest of its trip.': ['Clic droit sur une photo de la carte pour la masquer : pratique pour une photo égarée loin du reste de son voyage.', 'Rechtsklick auf ein Foto auf der Karte blendet es aus: praktisch für ein Foto weit weg vom Rest der Reise.', 'Clic derecho en una foto del mapa para ocultarla: útil para una foto lejos del resto de su viaje.', '在地图上右键点击照片即可隐藏:适合远离旅行其他照片的那张。'],
  'Import GPX Track…': ['Importer une trace GPX…', 'GPX-Track importieren…', 'Importar ruta GPX…', '导入 GPX 轨迹…'],
  'Entire Trip': ['Tout le voyage', 'Ganze Reise', 'Viaje completo', '整个旅行'],

  // Photo editor and PhotoMod
  'Open in PhotoMod': ['Ouvrir dans PhotoMod', 'In PhotoMod öffnen', 'Abrir en PhotoMod', '在 PhotoMod 中打开'],
  'Open this photo in PhotoMod - the full editor, with layers, text, selections and every tool': ["Ouvrir cette photo dans PhotoMod, l'éditeur complet avec calques, texte, sélections et tous les outils", 'Dieses Foto in PhotoMod öffnen, dem vollen Editor mit Ebenen, Text, Auswahlen und allen Werkzeugen', 'Abrir esta foto en PhotoMod, el editor completo con capas, texto, selecciones y todas las herramientas', '在 PhotoMod 中打开这张照片:完整编辑器,含图层、文字、选区和所有工具'],
  'Open Photo…': ['Ouvrir une photo…', 'Foto öffnen…', 'Abrir foto…', '打开照片…'],
  'Choose another photo from your library': ['Choisir une autre photo de votre bibliothèque', 'Ein anderes Foto aus der Bibliothek wählen', 'Elegir otra foto de tu biblioteca', '从照片库中选择另一张照片'],
  'Keep these edits on the photo in your library. Until you press this, nothing is saved.': ["Garder ces modifications sur la photo de votre bibliothèque. Tant que vous n'appuyez pas ici, rien n'est enregistré.", 'Diese Bearbeitung am Foto in der Bibliothek behalten. Bis Sie das drücken, wird nichts gespeichert.', 'Conservar estas ediciones en la foto de tu biblioteca. Hasta que lo pulses, no se guarda nada.', '将这些编辑保存在库中的照片上。按下之前不会保存任何内容。'],
  'Export': ['Exporter', 'Exportieren', 'Exportar', '导出'],
  'Save changes': ['Enregistrer', 'Änderungen speichern', 'Guardar cambios', '保存更改'],
  'Keep your edits on this photo and close the editor': ["Garder vos modifications sur cette photo et fermer l'éditeur", 'Bearbeitung behalten und den Editor schließen', 'Conservar tus ediciones en esta foto y cerrar el editor', '保留编辑并关闭编辑器'],
  'Zoom out (Ctrl+-)': ['Dézoomer (Ctrl+-)', 'Verkleinern (Strg+-)', 'Alejar (Ctrl+-)', '缩小(Ctrl+-)'],
  'Fit to window (Ctrl+0)': ['Ajuster à la fenêtre (Ctrl+0)', 'An Fenster anpassen (Strg+0)', 'Ajustar a la ventana (Ctrl+0)', '适合窗口(Ctrl+0)'],
  'Zoom in (Ctrl++)': ['Zoomer (Ctrl++)', 'Vergrößern (Strg++)', 'Acercar (Ctrl++)', '放大(Ctrl++)'],
  'Actual pixels (Ctrl+1)': ['Taille réelle (Ctrl+1)', 'Originalgröße (Strg+1)', 'Píxeles reales (Ctrl+1)', '实际像素(Ctrl+1)'],
  'Loading full-resolution image…': ["Chargement de l'image en pleine résolution…", 'Bild in voller Auflösung wird geladen…', 'Cargando imagen a resolución completa…', '正在加载全分辨率图像…'],
  'Hold to compare': ['Maintenir pour comparer', 'Halten zum Vergleichen', 'Mantén para comparar', '按住对比'],
  'Reset All': ['Tout réinitialiser', 'Alles zurücksetzen', 'Restablecer todo', '全部重置'],
  'Undo every adjustment, drawing, mask and layer on this photo (you can still Undo this)': ['Annuler tous les réglages, dessins, masques et calques de cette photo (vous pourrez encore annuler)', 'Alle Anpassungen, Zeichnungen, Masken und Ebenen auf diesem Foto zurücknehmen (lässt sich rückgängig machen)', 'Deshacer todos los ajustes, dibujos, máscaras y capas de esta foto (aún podrás deshacerlo)', '撤销这张照片上的所有调整、绘画、蒙版和图层(仍可撤销此操作)'],
  'Adjustments': ['Réglages', 'Anpassungen', 'Ajustes', '调整'],
  'Pick a photo to open in the full editor.': ["Choisissez une photo à ouvrir dans l'éditeur complet.", 'Wählen Sie ein Foto für den vollen Editor.', 'Elige una foto para abrir en el editor completo.', '选择一张照片在完整编辑器中打开。'],
  'Colors': ['Couleurs', 'Farben', 'Colores', '颜色'],
  'Direction': ['Orientation', 'Ausrichtung', 'Orientación', '方向'],
  'Brush': ['Pinceau', 'Pinsel', 'Pincel', '画笔'],
  'Masks': ['Masques', 'Masken', 'Máscaras', '蒙版'],
  'Curve': ['Courbe', 'Kurve', 'Curva', '曲线'],
  'Drag the line to bend it - it adds a point where you grab. Drag a point to reshape, double-click a point to remove it.': ['Faites glisser la ligne pour la courber : un point est ajouté là où vous la saisissez. Déplacez un point pour la modifier, double-cliquez dessus pour le supprimer.', 'Ziehen Sie die Linie, um sie zu biegen: wo Sie greifen, entsteht ein Punkt. Punkt ziehen zum Formen, Doppelklick entfernt ihn.', 'Arrastra la línea para curvarla: se añade un punto donde la agarres. Arrastra un punto para darle forma, doble clic para quitarlo.', '拖动线条使其弯曲,抓取处会添加一个点。拖动点可调整形状,双击点可删除。'],
  'reset all': ['tout réinitialiser', 'alles zurücksetzen', 'restablecer todo', '全部重置'],
  'reset': ['réinitialiser', 'zurücksetzen', 'restablecer', '重置'],
  'reset tilt': ["réinitialiser l'inclinaison", 'Neigung zurücksetzen', 'restablecer inclinación', '重置倾斜'],
  'Tilt': ['Inclinaison', 'Neigung', 'Inclinación', '倾斜'],
  'Left': ['Gauche', 'Links', 'Izquierda', '左'],
  'Right': ['Droite', 'Rechts', 'Derecha', '右'],
  'Rotate left 90°': ['Pivoter à gauche de 90°', 'Um 90° nach links drehen', 'Girar 90° a la izquierda', '向左旋转 90°'],
  'Rotate right 90°': ['Pivoter à droite de 90°', 'Um 90° nach rechts drehen', 'Girar 90° a la derecha', '向右旋转 90°'],
  'Left/Right fixes a photo taken sideways or upside down; Tilt fine-tunes a crooked horizon and auto-crops in so no empty corners show. Perspective (keystone) correction is not here yet.': ["Gauche/Droite redresse une photo prise de côté ou à l'envers ; Inclinaison corrige un horizon penché et recadre pour masquer les coins vides. La correction de perspective n'est pas encore là.", 'Links/Rechts richtet ein seitlich oder kopfüber aufgenommenes Foto aus; Neigung korrigiert einen schiefen Horizont und schneidet automatisch zu, damit keine leeren Ecken bleiben. Perspektivkorrektur gibt es noch nicht.', 'Izquierda/Derecha arregla una foto tomada de lado o al revés; Inclinación corrige un horizonte torcido y recorta para que no se vean esquinas vacías. La corrección de perspectiva aún no está.', '左/右用于修正横拍或倒拍的照片;倾斜用于微调歪斜的地平线,并自动裁剪避免空角。暂不支持透视校正。'],
  'Feather': ['Contour progressif', 'Weiche Kante', 'Difuminado', '羽化'],
  'Local adjustments': ['Réglages locaux', 'Lokale Anpassungen', 'Ajustes locales', '局部调整'],
  'Drag on the photo to paint this mask. Only the painted area is affected by the sliders above.': ['Peignez ce masque sur la photo. Seule la zone peinte est modifiée par les curseurs ci-dessus.', 'Malen Sie diese Maske auf das Foto. Nur der bemalte Bereich wird von den Reglern oben beeinflusst.', 'Pinta esta máscara sobre la foto. Solo la zona pintada se ve afectada por los controles de arriba.', '在照片上拖动绘制此蒙版。只有绘制区域受上方滑块影响。'],
  'Select a mask above, or add a new one, then paint on the photo to choose the area it affects.': ['Choisissez un masque ci-dessus ou ajoutez-en un, puis peignez sur la photo la zone concernée.', 'Wählen Sie oben eine Maske oder fügen Sie eine neue hinzu, dann malen Sie den betroffenen Bereich aufs Foto.', 'Elige una máscara arriba o añade una nueva y pinta en la foto la zona que afecta.', '选择上方的蒙版或新建一个,然后在照片上涂抹以选择影响区域。'],
  '+ New Mask': ['+ Nouveau masque', '+ Neue Maske', '+ Nueva máscara', '+ 新建蒙版'],
  'No masks yet - add one to edit part of the photo only.': ["Aucun masque pour l'instant : ajoutez-en un pour ne modifier qu'une partie de la photo.", 'Noch keine Masken: fügen Sie eine hinzu, um nur einen Teil des Fotos zu bearbeiten.', 'Aún no hay máscaras: añade una para editar solo parte de la foto.', '还没有蒙版:添加一个即可只编辑照片的一部分。'],
  'Text': ['Texte', 'Text', 'Texto', '文字'],
  'Letter spacing': ['Espacement des lettres', 'Zeichenabstand', 'Espaciado de letras', '字间距'],
  'Outline': ['Contour', 'Kontur', 'Contorno', '描边'],
  'Object': ['Objet', 'Objekt', 'Objeto', '对象'],
  'Colour': ['Couleur', 'Farbe', 'Color', '颜色'],
  'Tolerance': ['Tolérance', 'Toleranz', 'Tolerancia', '容差'],
  'Warp': ['Déformer', 'Verkrümmen', 'Deformar', '变形'],
  'Reset shape': ['Réinitialiser la forme', 'Form zurücksetzen', 'Restablecer forma', '重置形状'],
  'Right-click a layer for properties, colours and clipping. Drag rows to restack.': ["Clic droit sur un calque pour ses propriétés, couleurs et masque d'écrêtage. Glissez les lignes pour réordonner.", 'Rechtsklick auf eine Ebene für Eigenschaften, Farben und Schnittmaske. Zeilen ziehen zum Umordnen.', 'Clic derecho en una capa para propiedades, colores y recorte. Arrastra las filas para reordenar.', '右键点击图层查看属性、颜色和剪贴蒙版。拖动行可重新排序。'],
  'Selection': ['Sélection', 'Auswahl', 'Selección', '选区'],
  'Layers': ['Calques', 'Ebenen', 'Capas', '图层'],
  'Photo': ['Photo', 'Foto', 'Foto', '照片'],
  'original': ['original', 'Original', 'original', '原图'],
  'Paste an image with Ctrl+V, or use the T tool, to add a layer above the photo.': ["Collez une image avec Ctrl+V, ou utilisez l'outil T, pour ajouter un calque au-dessus de la photo.", 'Fügen Sie ein Bild mit Strg+V ein oder nutzen Sie das T-Werkzeug, um eine Ebene über dem Foto hinzuzufügen.', 'Pega una imagen con Ctrl+V o usa la herramienta T para añadir una capa sobre la foto.', '按 Ctrl+V 粘贴图片或使用 T 工具,在照片上方添加图层。'],
  'Paste an image with Ctrl+V, or press T for text, to add a layer.': ['Collez une image avec Ctrl+V, ou appuyez sur T pour du texte, pour ajouter un calque.', 'Fügen Sie ein Bild mit Strg+V ein oder drücken Sie T für Text, um eine Ebene hinzuzufügen.', 'Pega una imagen con Ctrl+V o pulsa T para texto, para añadir una capa.', '按 Ctrl+V 粘贴图片或按 T 输入文字,即可添加图层。'],
  'Properties': ['Propriétés', 'Eigenschaften', 'Propiedades', '属性'],
  'Colours': ['Couleurs', 'Farben', 'Colores', '颜色'],
  'Duplicate': ['Dupliquer', 'Duplizieren', 'Duplicar', '复制'],
  'Blend': ['Fusion', 'Mischmodus', 'Fusión', '混合'],
  'Opacity': ['Opacité', 'Deckkraft', 'Opacidad', '不透明度'],
  'Fill colour': ['Couleur de remplissage', 'Füllfarbe', 'Color de relleno', '填充颜色'],
  'Brush size': ['Taille du pinceau', 'Pinselgröße', 'Tamaño del pincel', '画笔大小'],
  'Current': ['Actuel', 'Aktuell', 'Actual', '当前'],
  'Visible': ['Visible', 'Sichtbar', 'Visible', '可见'],
  'Delete mask': ['Supprimer le masque', 'Maske löschen', 'Borrar máscara', '删除蒙版'],
  'Delete layer': ['Supprimer le calque', 'Ebene löschen', 'Borrar capa', '删除图层'],
  'Text colour': ['Couleur du texte', 'Textfarbe', 'Color del texto', '文字颜色'],
  'This layer has its own colour adjustments': ['Ce calque a ses propres réglages de couleur', 'Diese Ebene hat eigene Farbanpassungen', 'Esta capa tiene sus propios ajustes de color', '此图层有自己的颜色调整'],
  "Editing this layer's own colours": ['Modification des couleurs de ce calque', 'Farben dieser Ebene werden bearbeitet', 'Editando los colores de esta capa', '正在编辑此图层的颜色'],
  'Recognises whole objects, whatever their colours': ['Reconnaît des objets entiers, quelles que soient leurs couleurs', 'Erkennt ganze Objekte, egal welche Farbe', 'Reconoce objetos completos, sean del color que sean', '识别整个对象,不论颜色'],
  'Selects connected areas of similar colour (magic wand)': ['Sélectionne les zones voisines de couleur proche (baguette magique)', 'Wählt zusammenhängende Bereiche ähnlicher Farbe (Zauberstab)', 'Selecciona zonas contiguas de color parecido (varita mágica)', '选择颜色相近的相连区域(魔棒)'],
  'Push a mesh around to bend the layer': ['Déplacez une grille pour déformer le calque', 'Ein Gitter verschieben, um die Ebene zu biegen', 'Mueve una malla para deformar la capa', '推动网格来弯曲图层'],
  'More paint tools': ["Plus d'outils de peinture", 'Weitere Malwerkzeuge', 'Más herramientas de pintura', '更多绘画工具'],
  'Make whatever is inside the selection disappear, filled in from its surroundings': ["Faire disparaître le contenu de la sélection, rempli à partir de ce qui l'entoure", 'Alles in der Auswahl verschwinden lassen, aus der Umgebung aufgefüllt', 'Hacer desaparecer lo que hay en la selección, rellenándolo con su entorno', '让选区内的内容消失,并用周围内容填充'],
  'The full editor: layers, text, selections, transform and warp. Nothing is saved unless you save it.': ["L'éditeur complet : calques, texte, sélections, transformation et déformation. Rien n'est enregistré tant que vous n'enregistrez pas.", 'Der volle Editor: Ebenen, Text, Auswahlen, Transformieren und Verkrümmen. Nichts wird gespeichert, bevor Sie speichern.', 'El editor completo: capas, texto, selecciones, transformar y deformar. Nada se guarda hasta que guardes.', '完整编辑器:图层、文字、选区、变换和变形。不保存就不会改动。'],
  'Create a canvas': ['Créer une toile', 'Leinwand erstellen', 'Crear un lienzo', '创建画布'],
  'Start empty, at whatever size you choose.': ['Partir de zéro, à la taille de votre choix.', 'Leer beginnen, in beliebiger Größe.', 'Empieza vacío, del tamaño que elijas.', '从空白开始,尺寸随你定。'],
  'Work from a photo': ["Partir d'une photo", 'Mit einem Foto arbeiten', 'Partir de una foto', '从照片开始'],
  'Pick one from your Trove library.': ['Choisissez-en une dans votre bibliothèque Trove.', 'Wählen Sie eines aus Ihrer Trove-Bibliothek.', 'Elige una de tu biblioteca de Trove.', '从你的 Trove 照片库中选择。'],
  'New canvas': ['Nouvelle toile', 'Neue Leinwand', 'Nuevo lienzo', '新画布'],
  'Start from an empty document instead of a photo. You can still paste, add text and drop layers onto it.': ["Partir d'un document vide plutôt que d'une photo. Vous pouvez toujours coller, ajouter du texte et des calques.", 'Mit einem leeren Dokument statt einem Foto beginnen. Einfügen, Text und Ebenen gehen trotzdem.', 'Empieza con un documento vacío en vez de una foto. Puedes pegar, añadir texto y capas.', '从空白文档而非照片开始。仍可粘贴、添加文字和图层。'],
  'Width': ['Largeur', 'Breite', 'Ancho', '宽度'],
  'Height': ['Hauteur', 'Höhe', 'Alto', '高度'],
  'Background': ['Arrière-plan', 'Hintergrund', 'Fondo', '背景'],
  'White': ['Blanc', 'Weiß', 'Blanco', '白色'],
  'Black': ['Noir', 'Schwarz', 'Negro', '黑色'],
  'Custom colour': ['Couleur personnalisée', 'Eigene Farbe', 'Color personalizado', '自定义颜色'],
  'Canvas size': ['Taille de la toile', 'Leinwandgröße', 'Tamaño del lienzo', '画布大小'],
  "Changes how big the document is without resizing what's on it. Pick where the existing image sits in the new canvas.": ["Change la taille du document sans redimensionner son contenu. Choisissez où placer l'image existante dans la nouvelle toile.", 'Ändert die Dokumentgröße, ohne den Inhalt zu skalieren. Wählen Sie, wo das Bild auf der neuen Leinwand sitzt.', 'Cambia el tamaño del documento sin redimensionar su contenido. Elige dónde queda la imagen en el nuevo lienzo.', '更改文档大小而不缩放内容。选择现有图像在新画布中的位置。'],
  'Anchor': ['Ancrage', 'Anker', 'Anclaje', '锚点'],
  'Fill new space with': ['Remplir le nouvel espace avec', 'Neuen Platz füllen mit', 'Rellenar el espacio nuevo con', '新空间填充为'],
  'Image size': ["Taille de l'image", 'Bildgröße', 'Tamaño de la imagen', '图像大小'],
  'Rescales the document and everything on it, layers included.': ['Redimensionne le document et tout son contenu, calques compris.', 'Skaliert das Dokument mit allem darauf, Ebenen eingeschlossen.', 'Reescala el documento y todo su contenido, capas incluidas.', '缩放文档及其所有内容,包括图层。'],
  'Keep proportions': ['Conserver les proportions', 'Proportionen beibehalten', 'Mantener proporciones', '保持比例'],
  'Close without saving?': ['Fermer sans enregistrer ?', 'Ohne Speichern schließen?', '¿Cerrar sin guardar?', '不保存就关闭?'],
  "PhotoMod doesn't save as you go - your layers, masks and adjustments are only kept if you press Save (or Export them to a new file). Close now and this work is gone.": ["PhotoMod n'enregistre pas au fur et à mesure : calques, masques et réglages ne sont gardés que si vous appuyez sur Enregistrer (ou les exportez dans un nouveau fichier). Fermer maintenant fait perdre ce travail.", 'PhotoMod speichert nicht automatisch: Ebenen, Masken und Anpassungen bleiben nur, wenn Sie Speichern drücken (oder in eine neue Datei exportieren). Wenn Sie jetzt schließen, ist die Arbeit weg.', 'PhotoMod no guarda sobre la marcha: capas, máscaras y ajustes solo se conservan si pulsas Guardar (o los exportas a un archivo nuevo). Si cierras ahora, se pierde este trabajo.', 'PhotoMod 不会自动保存:只有按“保存”(或导出为新文件)才会保留图层、蒙版和调整。现在关闭,这些工作将会丢失。'],
  'Keep editing': ['Continuer', 'Weiter bearbeiten', 'Seguir editando', '继续编辑'],
  'Discard': ['Abandonner', 'Verwerfen', 'Descartar', '放弃'],

  // 360° player
  'Seek': ['Avancer', 'Springen', 'Buscar', '跳转'],
  'Play / pause (Space)': ['Lecture / pause (Espace)', 'Abspielen / Pause (Leertaste)', 'Reproducir / pausa (Espacio)', '播放 / 暂停(空格)'],
  'Mute (M)': ['Couper le son (M)', 'Stumm (M)', 'Silenciar (M)', '静音(M)'],
  'Volume': ['Volume', 'Lautstärke', 'Volumen', '音量'],
  "Angle lock: keeps the horizon level and smooths out shake, using the camera's own motion sensor (Shift+L)": ["Verrouillage d'angle : garde l'horizon droit et lisse les secousses grâce au capteur de mouvement de la caméra (Maj+L)", 'Winkelsperre: hält den Horizont gerade und glättet Wackler mit dem Bewegungssensor der Kamera (Umschalt+L)', 'Bloqueo de ángulo: mantiene el horizonte recto y suaviza las sacudidas con el sensor de movimiento de la cámara (Mayús+L)', '角度锁定:利用相机自带的运动传感器保持地平线水平并减少抖动(Shift+L)'],
  'Angle lock': ["Verrouillage d'angle", 'Winkelsperre', 'Bloqueo de ángulo', '角度锁定'],
  'Zoom out (-)': ['Dézoomer (-)', 'Verkleinern (-)', 'Alejar (-)', '缩小(-)'],
  'Zoom in (+)': ['Zoomer (+)', 'Vergrößern (+)', 'Acercar (+)', '放大(+)'],
  'Reset view (R)': ['Réinitialiser la vue (R)', 'Ansicht zurücksetzen (R)', 'Restablecer vista (R)', '重置视角(R)'],
  'Lens and projection settings': ['Réglages objectif et projection', 'Objektiv- und Projektionseinstellungen', 'Ajustes de lente y proyección', '镜头和投影设置'],
  'Lens & projection': ['Objectif et projection', 'Objektiv & Projektion', 'Lente y proyección', '镜头和投影'],
  'Lens field of view': ["Champ de vision de l'objectif", 'Sichtfeld des Objektivs', 'Campo de visión de la lente', '镜头视场'],
  'Lens rotation': ["Rotation de l'objectif", 'Objektivdrehung', 'Rotación de la lente', '镜头旋转'],
  'Swap front and back lens': ['Inverser objectif avant et arrière', 'Vorder- und Rückobjektiv tauschen', 'Intercambiar lente delantera y trasera', '交换前后镜头'],
  'Adjust these if the seam between the two lenses looks doubled or the horizon is tilted. Saved for next time.': ["Ajustez-les si la jonction entre les deux objectifs semble doublée ou si l'horizon penche. Gardé pour la prochaine fois.", 'Passen Sie diese an, wenn die Naht zwischen den Objektiven doppelt wirkt oder der Horizont schief ist. Wird gespeichert.', 'Ajústalos si la unión entre las dos lentes se ve doble o el horizonte está torcido. Se guarda para la próxima vez.', '如果两个镜头之间的接缝出现重影或地平线倾斜,请调整这些设置。会保存到下次。'],
  'Reset lens settings': ["Réinitialiser l'objectif", 'Objektiveinstellungen zurücksetzen', 'Restablecer ajustes de lente', '重置镜头设置'],
  'Grab a photo from this frame': ['Capturer une photo de cette image', 'Foto aus diesem Bild sichern', 'Capturar una foto de este fotograma', '从此画面截取照片'],
  'Fullscreen (F)': ['Plein écran (F)', 'Vollbild (F)', 'Pantalla completa (F)', '全屏(F)'],
  'Grab a photo': ['Capturer une photo', 'Foto sichern', 'Capturar una foto', '截取照片'],
  'This view': ['Cette vue', 'Diese Ansicht', 'Esta vista', '当前视角'],
  "A normal photo of exactly what's on screen, at full sharpness · G": ["Une photo normale de ce qui est à l'écran, en pleine netteté · G", 'Ein normales Foto genau dessen, was zu sehen ist, in voller Schärfe · G', 'Una foto normal de lo que hay en pantalla, con toda la nitidez · G', '按屏幕所见拍一张清晰的普通照片 · G'],
  'Full 360 photo': ['Photo 360 complète', 'Volles 360-Foto', 'Foto 360 completa', '完整 360 照片'],
  'The whole sphere, full resolution, opens as 360 in Trove, Google Photos, Facebook · Shift+G': ["Toute la sphère en pleine résolution, s'ouvre en 360 dans Trove, Google Photos, Facebook · Maj+G", 'Die ganze Kugel in voller Auflösung, öffnet sich als 360 in Trove, Google Fotos, Facebook · Umschalt+G', 'Toda la esfera a resolución completa, se abre en 360 en Trove, Google Fotos, Facebook · Mayús+G', '完整球面、全分辨率,可在 Trove、Google 相册、Facebook 中以 360 打开 · Shift+G'],
  'Drag to look around · Scroll to zoom · Double-click to reset': ['Glisser pour regarder autour · Molette pour zoomer · Double-clic pour réinitialiser', 'Ziehen zum Umsehen · Scrollen zum Zoomen · Doppelklick zum Zurücksetzen', 'Arrastra para mirar alrededor · Rueda para zoom · Doble clic para restablecer', '拖动环视 · 滚动缩放 · 双击重置'],
});

// Messages (toasts) and the remaining labels.
Object.assign(UI_TEXT, {
  'Could not encode the thumbnail': ["Impossible d'encoder la miniature", 'Vorschaubild konnte nicht kodiert werden', 'No se pudo codificar la miniatura', '无法编码缩略图'],
  'Could not save the thumbnail': ["Impossible d'enregistrer la miniature", 'Vorschaubild konnte nicht gespeichert werden', 'No se pudo guardar la miniatura', '无法保存缩略图'],
  'Could not open that image': ["Impossible d'ouvrir cette image", 'Dieses Bild konnte nicht geöffnet werden', 'No se pudo abrir esa imagen', '无法打开该图片'],
  'Thumbnail updated': ['Miniature mise à jour', 'Vorschaubild aktualisiert', 'Miniatura actualizada', '缩略图已更新'],
  'The video has not loaded a frame yet': ["La vidéo n'a pas encore chargé d'image", 'Das Video hat noch kein Bild geladen', 'El vídeo aún no ha cargado un fotograma', '视频尚未加载出画面'],
  'Thumbnail set to this frame': ['Miniature définie sur cette image', 'Vorschaubild auf dieses Bild gesetzt', 'Miniatura fijada en este fotograma', '已将此画面设为缩略图'],
  'Pause on the frame you want, then Thumbnail ▾ > Use current frame': ["Mettez en pause sur l'image voulue, puis Miniature ▾ > Utiliser l'image affichée", 'Beim gewünschten Bild pausieren, dann Vorschaubild ▾ > Aktuelles Bild verwenden', 'Pausa en el fotograma que quieras y luego Miniatura ▾ > Usar el fotograma actual', '在想要的画面暂停,然后点 缩略图 ▾ > 使用当前画面'],
  'Back to the automatic thumbnail': ['Retour à la miniature automatique', 'Zurück zum automatischen Vorschaubild', 'De vuelta a la miniatura automática', '已恢复自动缩略图'],
  'This PC has no HEIC decoder, so Trove decodes iPhone photos itself and they take a moment to open. Installing "HEVC Video Extensions" from the Microsoft Store makes them faster.': ["Ce PC n'a pas de décodeur HEIC : Trove décode lui-même les photos d'iPhone, elles mettent un instant à s'ouvrir. Installer « Extensions vidéo HEVC » depuis le Microsoft Store les accélère.", 'Dieser PC hat keinen HEIC-Decoder, daher dekodiert Trove iPhone-Fotos selbst und sie öffnen sich langsamer. „HEVC-Videoerweiterungen“ aus dem Microsoft Store machen es schneller.', 'Este PC no tiene decodificador HEIC, así que Trove decodifica las fotos de iPhone y tardan un poco en abrirse. Instalar «Extensiones de vídeo HEVC» de Microsoft Store las acelera.', '这台电脑没有 HEIC 解码器,Trove 会自行解码 iPhone 照片,打开会稍慢。从 Microsoft Store 安装“HEVC 视频扩展”可加快速度。'],
  'This folder has no files to learn from yet': ["Ce dossier n'a pas encore de fichiers dont apprendre", 'Dieser Ordner hat noch keine Dateien zum Lernen', 'Esta carpeta aún no tiene archivos de los que aprender', '此文件夹还没有可供学习的文件'],
  'Unlinked from its original': ['Délié de son original', 'Vom Original getrennt', 'Desenlazado de su original', '已取消与原图的关联'],
  'Reading photo dimensions…': ['Lecture des dimensions des photos…', 'Fotomaße werden gelesen…', 'Leyendo las dimensiones de las fotos…', '正在读取照片尺寸…'],
  'Sidebar order saved': ['Ordre de la barre latérale enregistré', 'Reihenfolge der Seitenleiste gespeichert', 'Orden de la barra lateral guardado', '侧边栏顺序已保存'],
  'Removed missing shortcuts': ['Raccourcis introuvables retirés', 'Fehlende Verknüpfungen entfernt', 'Accesos directos no encontrados quitados', '已移除缺失的快捷方式'],
  'Old backups cleaned up': ['Anciennes sauvegardes nettoyées', 'Alte Sicherungen aufgeräumt', 'Copias antiguas limpiadas', '已清理旧备份'],
  'Could not read that backup': ['Impossible de lire cette sauvegarde', 'Diese Sicherung konnte nicht gelesen werden', 'No se pudo leer esa copia', '无法读取该备份'],
  'Backup restored': ['Sauvegarde restaurée', 'Sicherung wiederhergestellt', 'Copia restaurada', '备份已恢复'],
  'Export cancelled': ['Export annulé', 'Export abgebrochen', 'Exportación cancelada', '已取消导出'],
  'Could not copy to clipboard': ['Impossible de copier dans le presse-papiers', 'Konnte nicht in die Zwischenablage kopieren', 'No se pudo copiar al portapapeles', '无法复制到剪贴板'],
  'Scroll the file into view to rename': ['Faites défiler jusqu\'au fichier pour le renommer', 'Scrollen Sie zur Datei, um sie umzubenennen', 'Desplázate hasta el archivo para renombrarlo', '请滚动到该文件再重命名'],
  'Renamed': ['Renommé', 'Umbenannt', 'Renombrado', '已重命名'],
  'No media in this folder yet': ["Pas encore de média dans ce dossier", 'Noch keine Medien in diesem Ordner', 'Aún no hay contenido en esta carpeta', '此文件夹还没有媒体'],
  'Cover photo set': ['Photo de couverture définie', 'Titelbild festgelegt', 'Foto de portada fijada', '已设置封面照片'],
  'Cover reset to automatic': ['Couverture remise en automatique', 'Titelbild wieder automatisch', 'Portada en automático', '封面已恢复自动'],
  'File deletion is turned off in Settings': ['La suppression de fichiers est désactivée dans les Paramètres', 'Das Löschen von Dateien ist in den Einstellungen aus', 'Borrar archivos está desactivado en Ajustes', '设置中已关闭删除文件'],
  'Deletion failed': ['La suppression a échoué', 'Löschen fehlgeschlagen', 'No se pudo borrar', '删除失败'],
  'All files already in library': ['Tous les fichiers sont déjà dans la bibliothèque', 'Alle Dateien sind schon in der Bibliothek', 'Todos los archivos ya están en la biblioteca', '所有文件都已在照片库中'],
  'Already in library': ['Déjà dans la bibliothèque', 'Schon in der Bibliothek', 'Ya está en la biblioteca', '已在照片库中'],
  'File not found - it may have moved': ['Fichier introuvable : il a peut-être été déplacé', 'Datei nicht gefunden: sie wurde vielleicht verschoben', 'Archivo no encontrado: puede que se haya movido', '找不到文件:可能已被移动'],
  'Live Photo video not found - it may have moved': ['Vidéo de la Live Photo introuvable : elle a peut-être été déplacée', 'Live-Photo-Video nicht gefunden: es wurde vielleicht verschoben', 'Vídeo de la Live Photo no encontrado: puede que se haya movido', '找不到实况照片的视频:可能已被移动'],
  'Folders updated': ['Dossiers mis à jour', 'Ordner aktualisiert', 'Carpetas actualizadas', '文件夹已更新'],
  'Folder updated': ['Dossier mis à jour', 'Ordner aktualisiert', 'Carpeta actualizada', '文件夹已更新'],
  'Pick an image file': ['Choisissez un fichier image', 'Wählen Sie eine Bilddatei', 'Elige un archivo de imagen', '请选择图片文件'],
  'Image too large - pick one under 2MB': ['Image trop lourde : choisissez-en une de moins de 2 Mo', 'Bild zu groß: wählen Sie eins unter 2 MB', 'Imagen demasiado grande: elige una de menos de 2 MB', '图片太大:请选择小于 2MB 的'],
  'Go back to "Add files" in the wizard to drop more in': ["Revenez à « Ajouter des fichiers » dans l'assistant pour en déposer d'autres", 'Gehen Sie im Assistenten zurück zu „Dateien hinzufügen“, um mehr abzulegen', 'Vuelve a «Añadir archivos» en el asistente para soltar más', '返回向导中的“添加文件”以放入更多'],
  'Could not read file paths': ['Impossible de lire les chemins des fichiers', 'Dateipfade konnten nicht gelesen werden', 'No se pudieron leer las rutas de los archivos', '无法读取文件路径'],
  'Scanning folder…': ['Analyse du dossier…', 'Ordner wird durchsucht…', 'Analizando carpeta…', '正在扫描文件夹…'],
  'No media found in that folder': ['Aucun média trouvé dans ce dossier', 'Keine Medien in diesem Ordner gefunden', 'No se encontró contenido en esa carpeta', '该文件夹中没有找到媒体'],
  'Loading globe…': ['Chargement du globe…', 'Globus wird geladen…', 'Cargando globo…', '正在加载地球…'],
  '3D library failed to load': ['La bibliothèque 3D ne s\'est pas chargée', '3D-Bibliothek konnte nicht geladen werden', 'No se pudo cargar la biblioteca 3D', '3D 库加载失败'],
  'Could not read that file': ['Impossible de lire ce fichier', 'Diese Datei konnte nicht gelesen werden', 'No se pudo leer ese archivo', '无法读取该文件'],
  'No track points found in that GPX file': ['Aucun point de trace dans ce fichier GPX', 'Keine Trackpunkte in dieser GPX-Datei', 'No hay puntos de ruta en ese archivo GPX', '该 GPX 文件中没有轨迹点'],
  'Add a free Mapbox token in Settings to snap these routes to real roads': ['Ajoutez un jeton Mapbox gratuit dans les Paramètres pour caler ces trajets sur de vraies routes', 'Fügen Sie in den Einstellungen ein kostenloses Mapbox-Token hinzu, um diese Routen an echte Straßen anzupassen', 'Añade un token gratuito de Mapbox en Ajustes para ajustar estas rutas a carreteras reales', '在设置中添加免费的 Mapbox 令牌,可将路线贴合到真实道路'],
  'Restored': ['Restauré', 'Wiederhergestellt', 'Restaurado', '已恢复'],
  'Keep at least one photo': ['Gardez au moins une photo', 'Behalten Sie mindestens ein Foto', 'Conserva al menos una foto', '请至少保留一张照片'],
  'Favorite saved': ['Préférée enregistrée', 'Favorit gespeichert', 'Favorita guardada', '已保存最爱'],
  'Nothing left to sort': ['Plus rien à trier', 'Nichts mehr zu sortieren', 'No queda nada por ordenar', '没有要整理的了'],
  'Select the photos first, then pick where they belong': ["Sélectionnez d'abord les photos, puis choisissez où elles vont", 'Wählen Sie zuerst die Fotos, dann wohin sie gehören', 'Selecciona primero las fotos y luego dónde van', '先选择照片,再选择归属位置'],
  'Nothing left to auto-group': ['Plus rien à regrouper automatiquement', 'Nichts mehr automatisch zu gruppieren', 'No queda nada por agrupar automáticamente', '没有可自动分组的了'],
  'Nothing selected - click at least one photo to file it here': ['Rien de sélectionné : cliquez sur au moins une photo pour la ranger ici', 'Nichts ausgewählt: klicken Sie mindestens ein Foto an, um es hier abzulegen', 'Nada seleccionado: haz clic en al menos una foto para archivarla aquí', '未选择:至少点击一张照片才能归档到这里'],
  'Nothing selected - click at least one photo to create the folder': ['Rien de sélectionné : cliquez sur au moins une photo pour créer le dossier', 'Nichts ausgewählt: klicken Sie mindestens ein Foto an, um den Ordner zu erstellen', 'Nada seleccionado: haz clic en al menos una foto para crear la carpeta', '未选择:至少点击一张照片才能创建文件夹'],
  'All photos already have a camera assigned': ['Toutes les photos ont déjà un appareil', 'Alle Fotos haben schon eine Kamera', 'Todas las fotos ya tienen cámara asignada', '所有照片都已分配相机'],
  'Click some photos from that camera first, then tap it': ["Cliquez d'abord sur des photos de cet appareil, puis touchez-le", 'Klicken Sie zuerst Fotos dieser Kamera an, dann tippen Sie sie an', 'Haz clic primero en fotos de esa cámara y luego tócala', '先点击该相机拍的照片,再点击相机'],
  'All photos already have a location': ['Toutes les photos ont déjà un lieu', 'Alle Fotos haben schon einen Ort', 'Todas las fotos ya tienen ubicación', '所有照片都已有位置'],
  'All photos now have a location': ['Toutes les photos ont maintenant un lieu', 'Alle Fotos haben jetzt einen Ort', 'Todas las fotos tienen ya ubicación', '现在所有照片都有位置了'],
  'Batch marked as sorted': ['Lot marqué comme trié', 'Stapel als sortiert markiert', 'Lote marcado como ordenado', '这批已标记为已整理'],
  'Nothing in To Sort right now': ['Rien dans À trier pour le moment', 'Gerade nichts in Zu sortieren', 'Nada en Por ordenar ahora mismo', '待整理中暂时没有内容'],
  'Checking for confident matches…': ['Recherche de correspondances sûres…', 'Suche nach sicheren Treffern…', 'Buscando coincidencias seguras…', '正在查找有把握的匹配…'],
  'No confident matches yet - the more you sort, the smarter this gets': ['Aucune correspondance sûre pour le moment : plus vous triez, plus il devient malin', 'Noch keine sicheren Treffer: je mehr Sie sortieren, desto klüger wird es', 'Aún no hay coincidencias seguras: cuanto más ordenes, más listo se vuelve', '暂无有把握的匹配:你整理得越多,它就越聪明'],
  'Could not read that image': ['Impossible de lire cette image', 'Dieses Bild konnte nicht gelesen werden', 'No se pudo leer esa imagen', '无法读取该图片'],
  'Nothing left to undo': ['Plus rien à annuler', 'Nichts mehr rückgängig zu machen', 'No queda nada por deshacer', '没有可撤销的了'],
  'Nothing to redo': ['Rien à rétablir', 'Nichts zu wiederholen', 'Nada que rehacer', '没有可重做的'],
  'The photo itself is never cut into - select a layer first, or use Copy': ["La photo elle-même n'est jamais découpée : sélectionnez d'abord un calque, ou utilisez Copier", 'Das Foto selbst wird nie zerschnitten: wählen Sie zuerst eine Ebene oder nutzen Sie Kopieren', 'La foto en sí nunca se recorta: selecciona primero una capa o usa Copiar', '照片本身不会被剪切:请先选择图层,或使用复制'],
  'The photo itself is never erased - select a layer first': ["La photo elle-même n'est jamais effacée : sélectionnez d'abord un calque", 'Das Foto selbst wird nie gelöscht: wählen Sie zuerst eine Ebene', 'La foto en sí nunca se borra: selecciona primero una capa', '照片本身不会被擦除:请先选择图层'],
  'Erased the selected area': ['Zone sélectionnée effacée', 'Ausgewählten Bereich gelöscht', 'Zona seleccionada borrada', '已擦除所选区域'],
  'Still filling in the last one…': ['Remplissage du précédent en cours…', 'Der letzte wird noch gefüllt…', 'Aún rellenando el anterior…', '仍在填充上一个…'],
  'Removed. That was a big area, so the fill is a little softer than the rest of the photo': ['Supprimé. La zone était grande, le remplissage est donc un peu plus flou que le reste de la photo', 'Entfernt. Der Bereich war groß, die Füllung ist daher etwas weicher als der Rest des Fotos', 'Eliminado. Era una zona grande, así que el relleno es algo más suave que el resto de la foto', '已移除。区域较大,因此填充比照片其他部分稍柔和'],
  'Object selection is unavailable on this computer - using Colour': ["La sélection d'objet n'est pas disponible sur cet ordinateur : utilisation de Couleur", 'Objektauswahl ist auf diesem Computer nicht verfügbar: Farbe wird verwendet', 'La selección de objetos no está disponible en este ordenador: se usa Color', '此电脑不支持对象选择:改用颜色'],
  'Object selection could not start on this computer - switched to Colour': ["La sélection d'objet n'a pas pu démarrer sur cet ordinateur : passage à Couleur", 'Objektauswahl konnte auf diesem Computer nicht starten: auf Farbe umgestellt', 'La selección de objetos no pudo iniciarse en este ordenador: se cambió a Color', '此电脑无法启动对象选择:已切换到颜色'],
  'Nothing to select there': ['Rien à sélectionner ici', 'Dort gibt es nichts auszuwählen', 'No hay nada que seleccionar ahí', '那里没有可选的内容'],
  'Could not load that photo': ['Impossible de charger cette photo', 'Dieses Foto konnte nicht geladen werden', 'No se pudo cargar esa foto', '无法加载该照片'],
  'Could not decode that photo': ['Impossible de décoder cette photo', 'Dieses Foto konnte nicht dekodiert werden', 'No se pudo decodificar esa foto', '无法解码该照片'],
  'Nothing to save yet': ['Rien à enregistrer pour le moment', 'Noch nichts zu speichern', 'Aún no hay nada que guardar', '还没有可保存的内容'],
  'Could not render the document': ['Impossible de rendre le document', 'Dokument konnte nicht gerendert werden', 'No se pudo generar el documento', '无法渲染文档'],
  'Saved the file, but could not add it to the library': ["Fichier enregistré, mais impossible de l'ajouter à la bibliothèque", 'Datei gespeichert, aber nicht zur Bibliothek hinzugefügt', 'Archivo guardado, pero no se pudo añadir a la biblioteca', '文件已保存,但无法添加到照片库'],
  'Select a layer first - Free Transform works on a layer, not the photo': ["Sélectionnez d'abord un calque : la transformation libre agit sur un calque, pas sur la photo", 'Wählen Sie zuerst eine Ebene: Frei transformieren wirkt auf Ebenen, nicht aufs Foto', 'Selecciona primero una capa: la transformación libre funciona en capas, no en la foto', '请先选择图层:自由变换作用于图层,而非照片'],
  'Select a layer first - Warp works on a layer, not the photo': ["Sélectionnez d'abord un calque : la déformation agit sur un calque, pas sur la photo", 'Wählen Sie zuerst eine Ebene: Verkrümmen wirkt auf Ebenen, nicht aufs Foto', 'Selecciona primero una capa: deformar funciona en capas, no en la foto', '请先选择图层:变形作用于图层,而非照片'],
  'Transform applied': ['Transformation appliquée', 'Transformation angewendet', 'Transformación aplicada', '已应用变换'],
  'Warp applied': ['Déformation appliquée', 'Verkrümmung angewendet', 'Deformación aplicada', '已应用变形'],
  'Filled the selection': ['Sélection remplie', 'Auswahl gefüllt', 'Selección rellenada', '已填充选区'],
  'Could not load this photo for editing': ["Impossible de charger cette photo pour l'édition", 'Dieses Foto konnte nicht zum Bearbeiten geladen werden', 'No se pudo cargar esta foto para editarla', '无法加载此照片进行编辑'],
  'Could not decode this photo': ['Impossible de décoder cette photo', 'Dieses Foto konnte nicht dekodiert werden', 'No se pudo decodificar esta foto', '无法解码此照片'],
  'The bottom layer has nothing beneath it to clip to': ["Le calque du bas n'a rien en dessous à quoi s'accrocher", 'Unter der untersten Ebene gibt es nichts zum Beschneiden', 'La capa inferior no tiene nada debajo a lo que recortarse', '最底层下方没有可剪贴的内容'],
  'Nothing to fill there': ['Rien à remplir ici', 'Dort gibt es nichts zu füllen', 'No hay nada que rellenar ahí', '那里没有可填充的内容'],
  'Drawing cleared': ['Dessin effacé', 'Zeichnung gelöscht', 'Dibujo borrado', '已清除绘画'],
  'WebGL is not available on this system': ["WebGL n'est pas disponible sur ce système", 'WebGL ist auf diesem System nicht verfügbar', 'WebGL no está disponible en este sistema', '此系统不支持 WebGL'],
  'Export failed': ["L'export a échoué", 'Export fehlgeschlagen', 'La exportación falló', '导出失败'],
  'Could not save the flattened copy - your layers were kept': ['Impossible d\'enregistrer la copie aplatie : vos calques sont conservés', 'Die zusammengefügte Kopie konnte nicht gespeichert werden: Ihre Ebenen bleiben erhalten', 'No se pudo guardar la copia acoplada: tus capas se conservan', '无法保存合并副本:图层已保留'],
  'Saved the flattened file but could not add it to the library': ["Fichier aplati enregistré, mais impossible de l'ajouter à la bibliothèque", 'Zusammengefügte Datei gespeichert, aber nicht zur Bibliothek hinzugefügt', 'Archivo acoplado guardado, pero no se pudo añadir a la biblioteca', '合并文件已保存,但无法添加到照片库'],
  'Could not encode the frame': ["Impossible d'encoder l'image", 'Bild konnte nicht kodiert werden', 'No se pudo codificar el fotograma', '无法编码画面'],
  'Could not save the frame next to the video': ["Impossible d'enregistrer l'image à côté de la vidéo", 'Bild konnte nicht neben dem Video gespeichert werden', 'No se pudo guardar el fotograma junto al vídeo', '无法将画面保存到视频旁'],
  'Saved the frame, but could not add it to the library': ["Image enregistrée, mais impossible de l'ajouter à la bibliothèque", 'Bild gespeichert, aber nicht zur Bibliothek hinzugefügt', 'Fotograma guardado, pero no se pudo añadir a la biblioteca', '画面已保存,但无法添加到照片库'],
  'Terrain relief unavailable - showing flat globe': ['Relief indisponible : affichage du globe plat', 'Geländerelief nicht verfügbar: flacher Globus', 'Relieve no disponible: se muestra el globo plano', '地形不可用:显示平面地球'],
  'Settings saved': ['Paramètres enregistrés', 'Einstellungen gespeichert', 'Ajustes guardados', '设置已保存'],
});

// Menus, the Sort menu, file-type groups, editor labels, Guided Sort's trip steps.
Object.assign(UI_TEXT, {
  'Click to expand/collapse - drag to reorder - right-click to hide': ['Cliquez pour déplier/replier, glissez pour réordonner, clic droit pour masquer', 'Klicken zum Auf-/Zuklappen, ziehen zum Umordnen, Rechtsklick zum Ausblenden', 'Clic para desplegar/plegar, arrastra para reordenar, clic derecho para ocultar', '点击展开/收起 · 拖动排序 · 右键隐藏'],
  'Click to expand/collapse - drag to reorder - right-click to rename, recolor or delete': ['Cliquez pour déplier/replier, glissez pour réordonner, clic droit pour renommer, changer la couleur ou supprimer', 'Klicken zum Auf-/Zuklappen, ziehen zum Umordnen, Rechtsklick zum Umbenennen, Umfärben oder Löschen', 'Clic para desplegar/plegar, arrastra para reordenar, clic derecho para renombrar, cambiar color o borrar', '点击展开/收起 · 拖动排序 · 右键重命名、改色或删除'],
  'Loading 360 media…': ['Chargement du média 360…', '360-Medien werden geladen…', 'Cargando contenido 360…', '正在加载 360 媒体…'],
  'Rotate 90°': ['Pivoter de 90°', 'Um 90° drehen', 'Girar 90°', '旋转 90°'],
  'Thumbnail…': ['Miniature…', 'Vorschaubild…', 'Miniatura…', '缩略图…'],
  'Set Location on Map…': ['Définir le lieu sur la carte…', 'Ort auf der Karte festlegen…', 'Fijar ubicación en el mapa…', '在地图上设置位置…'],
  'Open in Explorer': ["Ouvrir dans l'Explorateur", 'Im Explorer öffnen', 'Abrir en el Explorador', '在资源管理器中打开'],
  'Copy Path': ['Copier le chemin', 'Pfad kopieren', 'Copiar ruta', '复制路径'],
  'Remove or Delete…': ['Retirer ou supprimer…', 'Entfernen oder löschen…', 'Quitar o borrar…', '移除或删除…'],
  'Import image…': ['Importer une image…', 'Bild importieren…', 'Importar imagen…', '导入图片…'],
  'Reset to automatic': ['Revenir en automatique', 'Auf automatisch zurücksetzen', 'Volver a automático', '恢复自动'],
  'Add Sub-folder': ['Ajouter un sous-dossier', 'Unterordner hinzufügen', 'Añadir subcarpeta', '添加子文件夹'],
  'Create Camera Profile': ['Créer un profil d\'appareil', 'Kameraprofil erstellen', 'Crear perfil de cámara', '创建相机配置'],
  'Hide Section': ['Masquer la section', 'Bereich ausblenden', 'Ocultar sección', '隐藏分区'],
  'Edit Trip': ['Modifier le voyage', 'Reise bearbeiten', 'Editar viaje', '编辑旅行'],
  'Edit Folder': ['Modifier le dossier', 'Ordner bearbeiten', 'Editar carpeta', '编辑文件夹'],
  'Show all files ↓': ['Afficher tous les fichiers ↓', 'Alle Dateien zeigen ↓', 'Mostrar todos los archivos ↓', '显示所有文件 ↓'],
  'All trips': ['Tous les voyages', 'Alle Reisen', 'Todos los viajes', '所有旅行'],
  'All trips & adventures': ['Tous les voyages et aventures', 'Alle Reisen & Abenteuer', 'Todos los viajes y aventuras', '所有旅行和探险'],
  'All cameras': ['Tous les appareils', 'Alle Kameras', 'Todas las cámaras', '所有相机'],
  'All years': ['Toutes les années', 'Alle Jahre', 'Todos los años', '所有年份'],
  'All photos': ['Toutes les photos', 'Alle Fotos', 'Todas las fotos', '所有照片'],
  'Marked as sorted': ['Marqué comme trié', 'Als sortiert markiert', 'Marcado como ordenado', '已标记为已整理'],
  'Shortcut removed': ['Raccourci retiré', 'Verknüpfung entfernt', 'Acceso directo quitado', '已移除快捷方式'],
  'Properties saved': ['Propriétés enregistrées', 'Eigenschaften gespeichert', 'Propiedades guardadas', '属性已保存'],
  'Add files': ['Ajouter des fichiers', 'Dateien hinzufügen', 'Añadir archivos', '添加文件'],

  // Sort menu
  'Find duplicates & edits': ['Trouver les doublons et retouches', 'Duplikate & Bearbeitungen finden', 'Buscar duplicados y ediciones', '查找重复项和编辑版本'],
  "Find the people in your photos who aren't in People yet": ['Trouver les personnes de vos photos qui ne sont pas encore dans Personnes', 'Personen auf Ihren Fotos finden, die noch nicht in Personen sind', 'Encontrar a las personas de tus fotos que aún no están en Personas', '找出照片中尚未加入人物的人'],
  'Everyone in your photos is in People': ['Tout le monde sur vos photos est dans Personnes', 'Alle Personen auf Ihren Fotos sind in Personen', 'Todas las personas de tus fotos están en Personas', '照片中的所有人都已在人物中'],
  'Sort the To Sort pile': ['Trier la pile À trier', 'Den Stapel Zu sortieren abarbeiten', 'Ordenar la pila Por ordenar', '整理待整理照片'],
  'Nothing waiting': ['Rien en attente', 'Nichts wartet', 'Nada pendiente', '没有待处理的'],
  'No duplicates, and every edit is linked': ['Aucun doublon, et chaque retouche est liée', 'Keine Duplikate, und jede Bearbeitung ist verknüpft', 'Sin duplicados, y cada edición está enlazada', '没有重复项,所有编辑版本都已关联'],
  'The same photo twice, or an edit and its original: delete one or link them': ["La même photo en double, ou une retouche et son original : supprimez-en une ou liez-les", 'Dasselbe Foto doppelt, oder eine Bearbeitung und ihr Original: eins löschen oder verknüpfen', 'La misma foto dos veces, o una edición y su original: borra una o enlázalas', '同一张照片出现两次,或编辑版与原图:删除其一或关联'],

  // File-type groups (Sort by Type)
  'Images': ['Images', 'Bilder', 'Imágenes', '图片'],
  'Animations': ['Animations', 'Animationen', 'Animaciones', '动图'],
  'Camera thumbnails': ['Miniatures appareil', 'Kamera-Vorschaubilder', 'Miniaturas de cámara', '相机缩略图'],
  'Low-res preview videos': ['Vidéos de prévisualisation basse résolution', 'Vorschauvideos in niedriger Auflösung', 'Vídeos de vista previa de baja resolución', '低分辨率预览视频'],
  '360 videos': ['Vidéos 360', '360-Videos', 'Vídeos 360', '360 视频'],
  '360 photos': ['Photos 360', '360-Fotos', 'Fotos 360', '360 照片'],
  'TIFF images': ['Images TIFF', 'TIFF-Bilder', 'Imágenes TIFF', 'TIFF 图片'],
  'JPEG XL images': ['Images JPEG XL', 'JPEG-XL-Bilder', 'Imágenes JPEG XL', 'JPEG XL 图片'],
  'JPEG XR images': ['Images JPEG XR', 'JPEG-XR-Bilder', 'Imágenes JPEG XR', 'JPEG XR 图片'],
  'Camcorder videos': ['Vidéos de caméscope', 'Camcorder-Videos', 'Vídeos de videocámara', '摄像机视频'],
  'DVD videos': ['Vidéos DVD', 'DVD-Videos', 'Vídeos DVD', 'DVD 视频'],
  'RAW photos': ['Photos RAW', 'RAW-Fotos', 'Fotos RAW', 'RAW 照片'],
  'NO EXTENSION': ['SANS EXTENSION', 'OHNE ENDUNG', 'SIN EXTENSIÓN', '无扩展名'],

  // Guided Sort: trips
  'No dates set': ['Pas de dates', 'Keine Daten festgelegt', 'Sin fechas', '未设置日期'],
  'A trip': ['Un voyage', 'Eine Reise', 'Un viaje', '一趟旅行'],
  'Travel away from home': ['Un voyage loin de chez soi', 'Unterwegs, weg von zu Hause', 'Un viaje lejos de casa', '离家旅行'],
  'A trek, a festival, a day out': ['Une randonnée, un festival, une sortie', 'Eine Wanderung, ein Festival, ein Ausflug', 'Una caminata, un festival, una excursión', '徒步、节日、一日游'],
  'Everyday photos': ['Photos du quotidien', 'Alltagsfotos', 'Fotos del día a día', '日常照片'],
  'Add it': ["L'ajouter", 'Hinzufügen', 'Añadirlo', '添加'],
  'Create Folder & File Them': ['Créer le dossier et les y ranger', 'Ordner erstellen & ablegen', 'Crear carpeta y archivarlas', '创建文件夹并归档'],
  'Use this spot →': ['Utiliser cet endroit →', 'Diesen Ort verwenden →', 'Usar este lugar →', '使用此位置 →'],
  'Where from': ["D'où", 'Woher', 'De dónde', '来自哪里'],
  'Drive': ['Voiture', 'Auto', 'Coche', '驾车'],
  'Walk': ['À pied', 'Zu Fuß', 'A pie', '步行'],
  'Ferry': ['Ferry', 'Fähre', 'Ferry', '渡轮'],
  'Flight': ['Avion', 'Flug', 'Avión', '飞机'],
  'Visually the same picture.': ['Visuellement la même image.', 'Optisch dasselbe Bild.', 'Visualmente la misma imagen.', '视觉上是同一张图片。'],
  'Keep both': ['Garder les deux', 'Beide behalten', 'Conservar ambas', '两张都保留'],
  'Delete the rest of this burst?': ['Supprimer le reste de cette rafale ?', 'Rest dieser Serie löschen?', '¿Borrar el resto de esta ráfaga?', '删除这组连拍的其余照片?'],
  'Frame grab': ['Capture vidéo', 'Videostandbild', 'Captura de vídeo', '视频截图'],
  'dated': ['datée du', 'datiert', 'con fecha', '日期为'],

  // Photo editor & PhotoMod tools
  'Normal': ['Normal', 'Normal', 'Normal', '正常'],
  'Multiply': ['Produit', 'Multiplizieren', 'Multiplicar', '正片叠底'],
  'Screen': ['Superposition claire', 'Negativ multiplizieren', 'Trama', '滤色'],
  'Overlay': ['Incrustation', 'Ineinanderkopieren', 'Superponer', '叠加'],
  'Darken': ['Obscurcir', 'Abdunkeln', 'Oscurecer', '变暗'],
  'Lighten': ['Éclaircir', 'Aufhellen', 'Aclarar', '变亮'],
  'Color Dodge': ['Densité couleur -', 'Farbig abwedeln', 'Sobreexponer color', '颜色减淡'],
  'Color Burn': ['Densité couleur +', 'Farbig nachbelichten', 'Subexponer color', '颜色加深'],
  'Hard Light': ['Lumière crue', 'Hartes Licht', 'Luz fuerte', '强光'],
  'Soft Light': ['Lumière tamisée', 'Weiches Licht', 'Luz suave', '柔光'],
  'Difference': ['Différence', 'Differenz', 'Diferencia', '差值'],
  'Exclusion': ['Exclusion', 'Ausschluss', 'Exclusión', '排除'],
  'Hue': ['Teinte', 'Farbton', 'Tono', '色相'],
  'Saturation': ['Saturation', 'Sättigung', 'Saturación', '饱和度'],
  'Luminosity': ['Luminosité', 'Luminanz', 'Luminosidad', '明度'],
  'Cut out': ['Découper', 'Ausschneiden', 'Recortar', '抠出'],
  'Object removal': ["Suppression d'objet", 'Objektentfernung', 'Eliminación de objetos', '对象移除'],
  'Your text': ['Votre texte', 'Ihr Text', 'Tu texto', '你的文字'],
  'Add Photo & Place': ['Ajouter une photo et la placer', 'Foto hinzufügen & platzieren', 'Añadir foto y colocar', '添加并放置照片'],
  'No photos yet': ["Pas encore de photos", 'Noch keine Fotos', 'Aún no hay fotos', '还没有照片'],
  'Add some photos to your library first.': ["Ajoutez d'abord des photos à votre bibliothèque.", 'Fügen Sie zuerst Fotos zur Bibliothek hinzu.', 'Primero añade fotos a tu biblioteca.', '请先向照片库添加一些照片。'],
  'Duplicate layer': ['Dupliquer le calque', 'Ebene duplizieren', 'Duplicar capa', '复制图层'],
  'Flipped vertically': ['Retourné verticalement', 'Vertikal gespiegelt', 'Volteado verticalmente', '已垂直翻转'],
  'Flipped horizontally': ['Retourné horizontalement', 'Horizontal gespiegelt', 'Volteado horizontalmente', '已水平翻转'],
  'Pasted image': ['Image collée', 'Eingefügtes Bild', 'Imagen pegada', '粘贴的图片'],
  'Elliptical select': ['Sélection elliptique', 'Elliptische Auswahl', 'Selección elíptica', '椭圆选框'],
  'Auto select': ['Sélection automatique', 'Automatische Auswahl', 'Selección automática', '自动选择'],
  'Smart eraser': ['Gomme intelligente', 'Intelligenter Radierer', 'Borrador inteligente', '智能橡皮擦'],
  'Marker width': ['Largeur du marqueur', 'Markerbreite', 'Ancho del rotulador', '马克笔宽度'],
  'Color mix': ['Mélange de couleurs', 'Farbmischung', 'Mezcla de color', '混色'],
});

// Text with numbers or names, continued.
UI_PATTERNS.push(
  [/^Open (.+)$/, ['Ouvrir $1', '$1 öffnen', 'Abrir $1', '打开 $1']],
  [/^(\d+) to look at: copies to clear out or edits to link$/, ['$1 à voir : copies à supprimer ou retouches à lier', '$1 zu prüfen: Kopien entfernen oder Bearbeitungen verknüpfen', '$1 por revisar: copias que quitar o ediciones que enlazar', '$1 项待查看:要清理的副本或要关联的编辑版本']],
  [/^(\d+) photos? waiting, a question at a time$/, ['$1 photo(s) en attente, une question à la fois', '$1 Foto(s) warten, eine Frage nach der anderen', '$1 foto(s) pendiente(s), una pregunta cada vez', '$1 张照片待处理,一次一个问题']],
  [/^(\d+) to look at: people not in People yet, or missing from photos$/, ['$1 à voir : personnes pas encore dans Personnes, ou absentes de photos', '$1 zu prüfen: Personen noch nicht in Personen oder auf Fotos fehlend', '$1 por revisar: personas que aún no están en Personas o que faltan en fotos', '$1 项待查看:尚未加入人物或照片中缺失的人']],
  [/^(\d+) of (\d+) photos have (.+)$/, ['$1 photos sur $2 contiennent $3', '$1 von $2 Fotos haben $3', '$1 de $2 fotos tienen a $3', '$2 张照片中有 $1 张包含 $3']],
  [/^(\d+) of (\d+) photos in (.+)$/, ['$1 photos sur $2 dans $3', '$1 von $2 Fotos in $3', '$1 de $2 fotos en $3', '$2 张照片中有 $1 张在 $3']],
  [/^(\d+) selected - tap a person to add them$/, ['$1 sélectionnée(s) : touchez une personne pour les ajouter', '$1 ausgewählt: Person antippen, um sie hinzuzufügen', '$1 seleccionada(s): toca una persona para añadirlas', '已选 $1 张:点击人物以添加']],
  [/^(\d+) selected - pick a folder to add them$/, ['$1 sélectionnée(s) : choisissez un dossier pour les ajouter', '$1 ausgewählt: Ordner wählen, um sie hinzuzufügen', '$1 seleccionada(s): elige una carpeta para añadirlas', '已选 $1 张:选择文件夹以添加']],
  [/^(\d+) selected - tap a camera above to assign$/, ['$1 sélectionnée(s) : touchez un appareil ci-dessus pour attribuer', '$1 ausgewählt: oben eine Kamera antippen zum Zuweisen', '$1 seleccionada(s): toca una cámara arriba para asignar', '已选 $1 张:点击上方相机以分配']],
  [/^(\d+) photos? without a camera$/, ['$1 photo(s) sans appareil', '$1 Foto(s) ohne Kamera', '$1 foto(s) sin cámara', '$1 张照片没有相机']],
  [/^(\d+) left to check$/, ['$1 à vérifier', 'noch $1 zu prüfen', 'quedan $1 por revisar', '还有 $1 个待检查']],
  [/^(\d+) files?$/, ['$1 fichier(s)', '$1 Datei(en)', '$1 archivo(s)', '$1 个文件']],
  [/^(\d+) photos?$/, ['$1 photo(s)', '$1 Foto(s)', '$1 foto(s)', '$1 张照片']],
);

// Guided Sort's steps and sentences, the Duplicates summary, and the last tooltips.
Object.assign(UI_TEXT, {
  '- camera folders shown on cards are': ['- les dossiers appareil affichés sur les cartes sont des', '- die Kameraordner auf den Karten sind', '- las carpetas de cámara de las tarjetas son', '- 卡片上显示的相机文件夹只是'],
  'Not part of anything special': ['Rien de particulier', 'Nichts Besonderes', 'Nada en especial', '没有特别归属'],
  'Trips & adventures': ['Voyages et aventures', 'Reisen & Abenteuer', 'Viajes y aventuras', '旅行和探险'],
  'Check dates': ['Vérifier les dates', 'Daten prüfen', 'Comprobar fechas', '检查日期'],
  'Auto-Group': ['Regroupement auto', 'Automatisch gruppieren', 'Agrupar automáticamente', '自动分组'],
  'Every photo in this batch is in a trip or adventure now.': ['Toutes les photos de ce lot sont maintenant dans un voyage ou une aventure.', 'Jedes Foto dieses Stapels ist jetzt in einer Reise oder einem Abenteuer.', 'Todas las fotos de este lote están ya en un viaje o aventura.', '这批照片现在都已归入旅行或探险。'],
  'name': ['nom', 'Name', 'nombre', '名称'],
  'visual': ['visuel', 'optisch', 'visual', '视觉'],
  'Close the editor (asks first if there are edits you have not saved)': ["Fermer l'éditeur (demande d'abord s'il y a des modifications non enregistrées)", 'Editor schließen (fragt vorher, wenn es ungespeicherte Änderungen gibt)', 'Cerrar el editor (pregunta antes si hay ediciones sin guardar)', '关闭编辑器(如有未保存的编辑会先询问)'],
  'All done!': ['Tout est fait !', 'Alles erledigt!', '¡Todo listo!', '全部完成!'],
});

UI_PATTERNS.push(
  [/^Step (\d+) of (\d+) - (.+)\.$/, [m => `Étape ${m[1]} sur ${m[2]} : ${uiPart(m[3])}.`, m => `Schritt ${m[1]} von ${m[2]}: ${uiPart(m[3])}.`, m => `Paso ${m[1]} de ${m[2]}: ${uiPart(m[3])}.`, m => `第 ${m[1]} / ${m[2]} 步:${uiPart(m[3])}。`]],
  [/^Where are these (\d+) photos? from(?: \(taken (.+)\))?\? Pick everything that applies - one batch can mix a trip with everyday shots\. Your answer decides which steps come next\.$/, [
    m => `D'où viennent ces ${m[1]} photos${m[2] ? ` (prises ${m[2]})` : ''} ? Choisissez tout ce qui s'applique : un lot peut mélanger un voyage et des photos du quotidien. Votre réponse décide des étapes suivantes.`,
    m => `Woher stammen diese ${m[1]} Fotos${m[2] ? ` (aufgenommen ${m[2]})` : ''}? Wählen Sie alles Zutreffende: ein Stapel kann eine Reise mit Alltagsfotos mischen. Ihre Antwort bestimmt die nächsten Schritte.`,
    m => `¿De dónde son estas ${m[1]} fotos${m[2] ? ` (tomadas ${m[2]})` : ''}? Elige todo lo que corresponda: un lote puede mezclar un viaje con fotos del día a día. Tu respuesta decide los siguientes pasos.`,
    m => `这 ${m[1]} 张照片来自哪里${m[2] ? `(拍摄于 ${m[2]})` : ''}?选择所有适用项:一批照片可以混合旅行和日常照片。你的回答决定接下来的步骤。`]],
  [/^Which (.+) are these from\? Select every one that applies( - the ones whose dates match these photos are already ticked)?\. Next, photos are matched to them by date automatically\.$/, [
    m => `De quels ${uiPart(m[1]).toLowerCase()} viennent-elles ? Choisissez tous ceux qui s'appliquent${m[2] ? ' (ceux dont les dates correspondent sont déjà cochés)' : ''}. Ensuite, les photos y sont associées automatiquement par date.`,
    m => `Aus welchen ${uiPart(m[1])} stammen sie? Wählen Sie alle zutreffenden${m[2] ? ' (die mit passenden Daten sind schon angehakt)' : ''}. Danach werden die Fotos automatisch per Datum zugeordnet.`,
    m => `¿De qué ${uiPart(m[1]).toLowerCase()} son? Elige todos los que correspondan${m[2] ? ' (los que coinciden en fecha ya están marcados)' : ''}. Después, las fotos se asocian automáticamente por fecha.`,
    m => `这些照片来自哪些${uiPart(m[1])}?选择所有适用项${m[2] ? '(日期匹配的已自动勾选)' : ''}。接着会按日期自动匹配照片。`]],
  [/^(\d+) photos? (?:aren't|isn't) in any trip or adventure yet( - taken outside the dates you picked)?\. Are they part of something\? .*$/, [
    m => `${m[1]} photo(s) ne sont dans aucun voyage ni aventure${m[2] ? ', prises en dehors des dates choisies' : ''}. Font-elles partie de quelque chose ? Sélectionnez-les et ajoutez-les à un voyage ou une aventure, même si les dates ne correspondent pas (une vidéo montée au retour, par exemple). Ou indiquez qu'elles n'en font partie d'aucun.`,
    m => `${m[1]} Foto(s) sind noch in keiner Reise und keinem Abenteuer${m[2] ? ', aufgenommen außerhalb der gewählten Daten' : ''}. Gehören sie zu etwas? Wählen Sie sie aus und fügen Sie sie einer Reise oder einem Abenteuer hinzu, auch wenn die Daten nicht passen (etwa ein zu Hause geschnittenes Video). Oder markieren Sie sie als zu nichts gehörend.`,
    m => `${m[1]} foto(s) aún no están en ningún viaje ni aventura${m[2] ? ', tomadas fuera de las fechas elegidas' : ''}. ¿Forman parte de algo? Selecciónalas y añádelas a un viaje o aventura, aunque las fechas no coincidan (un vídeo editado al volver, por ejemplo). O márcalas como que no forman parte de ninguno.`,
    m => `有 ${m[1]} 张照片还不属于任何旅行或探险${m[2] ? '(拍摄于所选日期之外)' : ''}。它们属于某个旅行吗?选中后添加到旅行或探险,即使日期不符(比如回家后剪辑的视频)也可以。或标记为不属于任何一个。`]],
  [/^Found (\d+) match(?:es)? out of (\d+) photos? - review below, nothing is filed until you confirm\.$/, ['$1 correspondance(s) trouvée(s) sur $2 photo(s) : vérifiez ci-dessous, rien n\'est rangé avant votre confirmation.', '$1 Treffer unter $2 Foto(s): unten prüfen, nichts wird ohne Ihre Bestätigung abgelegt.', '$1 coincidencia(s) entre $2 foto(s): revísalas abajo, no se archiva nada hasta que confirmes.', '在 $2 张照片中找到 $1 个匹配:请在下方检查,确认前不会归档任何内容。']],
  [/^No confident matches or groups found among these (\d+) photos? - continue whenever ready\.$/, ['Aucune correspondance ni groupe sûr parmi ces $1 photo(s) : continuez quand vous voulez.', 'Keine sicheren Treffer oder Gruppen unter diesen $1 Foto(s): weiter, wann Sie möchten.', 'No hay coincidencias ni grupos seguros entre estas $1 foto(s): continúa cuando quieras.', '这 $1 张照片中没有有把握的匹配或分组:准备好就继续。']],
  [/^(\d+) photos? (?:have|has) no camera assigned yet\. Click the ones from the same camera, then tap it below\. Click 🔍 on a photo to see it larger\.$/, ["$1 photo(s) n'ont pas encore d'appareil. Cliquez sur celles du même appareil, puis touchez-le ci-dessous. Cliquez sur 🔍 pour agrandir une photo.", '$1 Foto(s) haben noch keine Kamera. Klicken Sie die derselben Kamera an und tippen Sie sie unten an. 🔍 vergrößert ein Foto.', '$1 foto(s) aún no tienen cámara. Haz clic en las de la misma cámara y tócala abajo. Haz clic en 🔍 para ver una foto más grande.', '有 $1 张照片尚未分配相机。点击同一相机拍的照片,再点击下方的相机。点击照片上的 🔍 可放大。']],
  [/^You went through (\d+) photos?\. Mark this batch as sorted, or leave it in To Sort to revisit later\.$/, ['Vous avez parcouru $1 photo(s). Marquez ce lot comme trié, ou laissez-le dans À trier pour y revenir plus tard.', 'Sie haben $1 Foto(s) durchgesehen. Markieren Sie den Stapel als sortiert oder lassen Sie ihn in Zu sortieren.', 'Has revisado $1 foto(s). Marca este lote como ordenado o déjalo en Por ordenar para volver más tarde.', '你已查看 $1 张照片。可将这批标记为已整理,或留在待整理稍后再看。']],
  [/^(\d+) edits? to link$/, ['$1 retouche(s) à lier', '$1 Bearbeitung(en) zu verknüpfen', '$1 edición(es) por enlazar', '$1 个编辑版本待关联']],
  [/^(\d+) duplicate groups?$/, ['$1 groupe(s) de doublons', '$1 Duplikatgruppe(n)', '$1 grupo(s) de duplicados', '$1 组重复项']],
  [/^(.+) could be freed$/, ['$1 libérables', '$1 könnten frei werden', 'se podrían liberar $1', '可释放 $1']],
  [/^(\d+) copies$/, ['$1 copies', '$1 Kopien', '$1 copias', '$1 个副本']],
  [/^(\d+)%$/, ['$1 %', '$1 %', '$1 %', '$1%']],
  [/^Add a subfolder inside (.+)$/, ['Ajouter un sous-dossier dans $1', 'Unterordner in $1 hinzufügen', 'Añadir una subcarpeta dentro de $1', '在 $1 中添加子文件夹']],
);

// Backups' storage line, part by part.
UI_PATTERNS.push(
  [/^Library file: (.+)$/, ['Fichier de la bibliothèque : $1', 'Bibliotheksdatei: $1', 'Archivo de la biblioteca: $1', '照片库文件:$1']],
  [/^Backups: (\d+) snapshots?, (.+) \(capped at (\d+) \/ (.+)\)$/, ['Sauvegardes : $1 instantané(s), $2 (limite $3 / $4)', 'Sicherungen: $1 Schnappschuss/-schüsse, $2 (Grenze $3 / $4)', 'Copias: $1 instantánea(s), $2 (límite $3 / $4)', '备份:$1 个快照,$2(上限 $3 / $4)']],
  [/^Thumbnails: (.+)$/, ['Miniatures : $1', 'Vorschaubilder: $1', 'Miniaturas: $1', '缩略图:$1']],
);

// PhotoMod: menus, menu items, tool tooltips and hints; the Globe's counts.
Object.assign(UI_TEXT, {
  'File': ['Fichier', 'Datei', 'Archivo', '文件'],
  'Edit': ['Édition', 'Bearbeiten', 'Editar', '编辑'],
  'Image': ['Image', 'Bild', 'Imagen', '图像'],
  'Layer': ['Calque', 'Ebene', 'Capa', '图层'],
  'Select': ['Sélection', 'Auswahl', 'Seleccionar', '选择'],
  'Add photo & place…': ['Ajouter une photo et la placer…', 'Foto hinzufügen & platzieren…', 'Añadir foto y colocar…', '添加并放置照片…'],
  'Adjustments…': ['Réglages…', 'Anpassungen…', 'Ajustes…', '调整…'],
  'Bring forward': ["Mettre au premier plan", 'Nach vorne', 'Traer adelante', '上移一层'],
  'Send backward': ["Mettre à l'arrière-plan", 'Nach hinten', 'Enviar atrás', '下移一层'],
  'Canvas size…': ['Taille de la toile…', 'Leinwandgröße…', 'Tamaño del lienzo…', '画布大小…'],
  'Image size…': ["Taille de l'image…", 'Bildgröße…', 'Tamaño de la imagen…', '图像大小…'],
  'Copy to new layer': ['Copier vers un nouveau calque', 'Auf neue Ebene kopieren', 'Copiar a una capa nueva', '复制到新图层'],
  'Cut to new layer': ['Couper vers un nouveau calque', 'Auf neue Ebene ausschneiden', 'Cortar a una capa nueva', '剪切到新图层'],
  'Erase selection': ['Effacer la sélection', 'Auswahl löschen', 'Borrar selección', '擦除选区'],
  'Fill selection': ['Remplir la sélection', 'Auswahl füllen', 'Rellenar selección', '填充选区'],
  'Export…': ['Exporter…', 'Exportieren…', 'Exportar…', '导出…'],
  'Flatten into one layer': ['Aplatir en un seul calque', 'Auf eine Ebene reduzieren', 'Acoplar en una capa', '合并为一个图层'],
  'Flip horizontal': ['Retourner horizontalement', 'Horizontal spiegeln', 'Voltear horizontal', '水平翻转'],
  'Flip vertical': ['Retourner verticalement', 'Vertikal spiegeln', 'Voltear vertical', '垂直翻转'],
  'Inverse': ['Inverser', 'Umkehren', 'Invertir', '反选'],
  'New canvas…': ['Nouvelle toile…', 'Neue Leinwand…', 'Nuevo lienzo…', '新画布…'],
  'New text layer': ['Nouveau calque de texte', 'Neue Textebene', 'Nueva capa de texto', '新建文字图层'],
  'Open photo…': ['Ouvrir une photo…', 'Foto öffnen…', 'Abrir foto…', '打开照片…'],
  'Reset everything': ['Tout réinitialiser', 'Alles zurücksetzen', 'Restablecer todo', '全部重置'],
  'Save to library': ['Enregistrer dans la bibliothèque', 'In der Bibliothek speichern', 'Guardar en la biblioteca', '保存到照片库'],
  'Transform': ['Transformer', 'Transformieren', 'Transformar', '变换'],
  'Move': ['Déplacer', 'Verschieben', 'Mover', '移动'],
  'Rectangular select': ['Sélection rectangulaire', 'Rechteckige Auswahl', 'Selección rectangular', '矩形选框'],
  'Polygon lasso': ['Lasso polygonal', 'Polygon-Lasso', 'Lazo poligonal', '多边形套索'],
  'Eyedropper': ['Pipette', 'Pipette', 'Cuentagotas', '吸管'],
  'Trips only': ['Voyages seulement', 'Nur Reisen', 'Solo viajes', '仅旅行'],
  'Adventures only': ['Aventures seulement', 'Nur Abenteuer', 'Solo aventuras', '仅探险'],
  'Working…': ['En cours…', 'Wird bearbeitet…', 'Trabajando…', '处理中…'],
  'Filling in…': ['Remplissage…', 'Wird gefüllt…', 'Rellenando…', '正在填充…'],
  'Close PhotoMod (asks first if there is anything unsaved)': ["Fermer PhotoMod (demande d'abord s'il reste quelque chose de non enregistré)", 'PhotoMod schließen (fragt vorher, wenn etwas ungespeichert ist)', 'Cerrar PhotoMod (pregunta antes si hay algo sin guardar)', '关闭 PhotoMod(如有未保存内容会先询问)'],
  'Move  (V)  - drag a layer': ['Déplacer (V) : faire glisser un calque', 'Verschieben (V): eine Ebene ziehen', 'Mover (V): arrastra una capa', '移动(V):拖动图层'],
  'Transform  (Ctrl+T)  - drag the corners to scale; right-click for distort, skew and perspective': ['Transformer (Ctrl+T) : tirez les coins pour redimensionner ; clic droit pour déformer, incliner et perspective', 'Transformieren (Strg+T): Ecken ziehen zum Skalieren; Rechtsklick für Verzerren, Neigen und Perspektive', 'Transformar (Ctrl+T): arrastra las esquinas para escalar; clic derecho para distorsionar, sesgar y perspectiva', '变换(Ctrl+T):拖动四角缩放;右键可扭曲、斜切和透视'],
  'Warp  (W)  - push and pull a mesh over the layer to bend it': ['Déformer (W) : poussez et tirez une grille sur le calque pour le courber', 'Verkrümmen (W): ein Gitter über der Ebene schieben und ziehen, um sie zu biegen', 'Deformar (W): empuja y tira de una malla sobre la capa para curvarla', '变形(W):推拉图层上的网格使其弯曲'],
  'Rectangular select  (M)  - then cut, copy, fill or erase': ['Sélection rectangulaire (M) : puis couper, copier, remplir ou effacer', 'Rechteckige Auswahl (M): dann ausschneiden, kopieren, füllen oder löschen', 'Selección rectangular (M): luego corta, copia, rellena o borra', '矩形选框(M):然后剪切、复制、填充或擦除'],
  'Elliptical select  (M again)  - hold Shift for a circle': ['Sélection elliptique (M à nouveau) : Maj pour un cercle', 'Elliptische Auswahl (nochmals M): Umschalt für einen Kreis', 'Selección elíptica (M otra vez): Mayús para un círculo', '椭圆选框(再按 M):按住 Shift 画正圆'],
  'Polygon lasso  (L)  - click once per corner, Enter or the first point to close': ['Lasso polygonal (L) : un clic par coin, Entrée ou le premier point pour fermer', 'Polygon-Lasso (L): ein Klick pro Ecke, Enter oder der erste Punkt schließt', 'Lazo poligonal (L): un clic por esquina, Intro o el primer punto para cerrar', '多边形套索(L):每个角点击一次,按 Enter 或点击第一个点闭合'],
  'Auto select  (A)  - click an object to select it; Shift+click adds, Alt+click takes away': ['Sélection automatique (A) : cliquez sur un objet pour le sélectionner ; Maj+clic ajoute, Alt+clic retire', 'Automatische Auswahl (A): Objekt anklicken; Umschalt+Klick fügt hinzu, Alt+Klick nimmt weg', 'Selección automática (A): haz clic en un objeto; Mayús+clic añade, Alt+clic quita', '自动选择(A):点击对象即可选中;Shift+点击添加,Alt+点击减去'],
  'Text  (T)  - add a text layer, straight or on a curve': ['Texte (T) : ajouter un calque de texte, droit ou sur une courbe', 'Text (T): eine Textebene hinzufügen, gerade oder auf einer Kurve', 'Texto (T): añade una capa de texto, recta o en curva', '文字(T):添加直线或曲线文字图层'],
  'Brush  (B)  - click the arrow for brush, highlighter and bucket': ['Pinceau (B) : cliquez sur la flèche pour pinceau, surligneur et pot de peinture', 'Pinsel (B): Pfeil anklicken für Pinsel, Textmarker und Farbeimer', 'Pincel (B): haz clic en la flecha para pincel, rotulador y bote', '画笔(B):点击箭头切换画笔、荧光笔和油漆桶'],
  'Brush  (B)  - paint on the document': ['Pinceau (B) : peindre sur le document', 'Pinsel (B): auf das Dokument malen', 'Pincel (B): pinta en el documento', '画笔(B):在文档上绘画'],
  'Eraser  (E)  - rub your painting back off': ['Gomme (E) : effacer votre peinture', 'Radierer (E): Ihre Malerei wieder wegradieren', 'Borrador (E): borra lo que pintaste', '橡皮擦(E):擦掉你的绘画'],
  'Smart eraser  (J)  - paint over an object and it disappears, filled in from its surroundings': ["Gomme intelligente (J) : peignez sur un objet et il disparaît, rempli à partir de ce qui l'entoure", 'Intelligenter Radierer (J): über ein Objekt malen, und es verschwindet, aus der Umgebung aufgefüllt', 'Borrador inteligente (J): pinta sobre un objeto y desaparece, rellenado con su entorno', '智能橡皮擦(J):涂抹对象即可让它消失,并用周围内容填充'],
  'Eyedropper  (I)  - pick a colour off the canvas': ['Pipette (I) : prélever une couleur sur la toile', 'Pipette (I): eine Farbe von der Leinwand aufnehmen', 'Cuentagotas (I): toma un color del lienzo', '吸管(I):从画布上取色'],
  'Mask brush  (K)  - paint where an adjustment applies': ["Pinceau de masque (K) : peindre là où s'applique un réglage", 'Maskenpinsel (K): malen, wo eine Anpassung wirkt', 'Pincel de máscara (K): pinta dónde se aplica un ajuste', '蒙版画笔(K):绘制调整生效的区域'],
  'Click anywhere on the canvas to take that colour. It becomes the brush and fill colour.': ['Cliquez sur la toile pour prélever cette couleur. Elle devient la couleur du pinceau et du remplissage.', 'Klicken Sie irgendwo auf die Leinwand, um die Farbe aufzunehmen. Sie wird Pinsel- und Füllfarbe.', 'Haz clic en cualquier parte del lienzo para tomar ese color. Será el color del pincel y del relleno.', '点击画布任意位置取色,它将成为画笔和填充颜色。'],
  'Click once for each corner of the outline. Click the yellow first point, double-click, or press Enter to close it. Backspace takes back the last point, Escape starts over.': ['Cliquez une fois par coin du contour. Cliquez sur le premier point jaune, double-cliquez ou appuyez sur Entrée pour fermer. Retour arrière retire le dernier point, Échap recommence.', 'Klicken Sie einmal pro Ecke der Kontur. Gelben ersten Punkt anklicken, doppelklicken oder Enter schließt sie. Rücktaste nimmt den letzten Punkt zurück, Esc beginnt neu.', 'Haz clic una vez por cada esquina del contorno. Clic en el primer punto amarillo, doble clic o Intro para cerrarlo. Retroceso quita el último punto, Esc empieza de nuevo.', '在轮廓的每个角点击一次。点击黄色起点、双击或按 Enter 闭合。退格键撤回上一个点,Esc 重新开始。'],
  'Click the arrow on the rail to switch between brush, highlighter and bucket - or press B to cycle them.': ['Cliquez sur la flèche de la barre pour passer du pinceau au surligneur et au pot de peinture, ou appuyez sur B pour les alterner.', 'Klicken Sie auf den Pfeil in der Leiste, um zwischen Pinsel, Textmarker und Farbeimer zu wechseln, oder drücken Sie B.', 'Haz clic en la flecha de la barra para cambiar entre pincel, rotulador y bote, o pulsa B para alternarlos.', '点击工具栏上的箭头在画笔、荧光笔和油漆桶之间切换,或按 B 循环切换。'],
  'Drag a layer to reposition it. Pick a layer below, or click it on the canvas.': ['Faites glisser un calque pour le déplacer. Choisissez un calque ci-dessous, ou cliquez dessus sur la toile.', 'Ziehen Sie eine Ebene, um sie zu verschieben. Ebene unten wählen oder auf der Leinwand anklicken.', 'Arrastra una capa para moverla. Elige una capa abajo o haz clic en ella en el lienzo.', '拖动图层可移动位置。在下方选择图层,或在画布上点击它。'],
  'Drag any grid point to push the picture around. The mesh bends smoothly between the points you move.': ["Faites glisser un point de la grille pour pousser l'image. La grille se courbe en douceur entre les points déplacés.", 'Ziehen Sie einen Gitterpunkt, um das Bild zu verschieben. Das Gitter biegt sich weich zwischen den bewegten Punkten.', 'Arrastra cualquier punto de la malla para empujar la imagen. La malla se curva suavemente entre los puntos que muevas.', '拖动任意网格点推动画面,网格会在移动的点之间平滑弯曲。'],
  'Drag out a shape. Hold Shift while dragging to keep it square or circular.': ['Tracez une forme. Maintenez Maj pour la garder carrée ou ronde.', 'Ziehen Sie eine Form auf. Halten Sie Umschalt, um sie quadratisch oder rund zu halten.', 'Arrastra para dibujar una forma. Mantén Mayús para que sea cuadrada o circular.', '拖出一个形状。拖动时按住 Shift 保持正方形或圆形。'],
  'Paint over the thing you want gone - a person, a sign, a stray bin - and let go. It is filled in from what surrounds it. Cover the whole object, shadow included, with a little margin.': ["Peignez sur ce que vous voulez faire disparaître (une personne, un panneau, une poubelle) et relâchez. C'est rempli à partir de ce qui l'entoure. Couvrez tout l'objet, ombre comprise, avec un peu de marge.", 'Malen Sie über das, was weg soll (eine Person, ein Schild, eine Mülltonne), und lassen Sie los. Es wird aus der Umgebung aufgefüllt. Decken Sie das ganze Objekt samt Schatten mit etwas Rand ab.', 'Pinta sobre lo que quieras quitar (una persona, un cartel, una papelera) y suelta. Se rellena con lo que lo rodea. Cubre todo el objeto, sombra incluida, con algo de margen.', '涂抹想要去掉的东西(行人、标牌、垃圾桶)后松开,它会用周围内容填充。请覆盖整个对象(包括阴影)并留一点边距。'],
  'The fill lands on its own "Object removal" layer, so the photo underneath is untouched: hide or delete that layer to bring the object back, or press Ctrl+Z.': ["Le remplissage va sur son propre calque « Suppression d'objet », la photo dessous reste intacte : masquez ou supprimez ce calque pour faire revenir l'objet, ou appuyez sur Ctrl+Z.", 'Die Füllung landet auf einer eigenen Ebene „Objektentfernung“, das Foto darunter bleibt unberührt: Ebene ausblenden oder löschen bringt das Objekt zurück, oder Strg+Z.', 'El relleno va en su propia capa «Eliminación de objetos», la foto de debajo queda intacta: oculta o borra esa capa para recuperar el objeto, o pulsa Ctrl+Z.', '填充内容位于单独的“对象移除”图层,下方照片不受影响:隐藏或删除该图层即可恢复对象,或按 Ctrl+Z。'],
});

UI_PATTERNS.push(
  [/^(\d+) geotagged files?$/, ['$1 fichier(s) géolocalisé(s)', '$1 Datei(en) mit Ortsangabe', '$1 archivo(s) con ubicación', '$1 个带位置的文件']],
);

// Photo editor: sliders, colour bands, Brush tab.
Object.assign(UI_TEXT, {
  'Light': ['Lumière', 'Licht', 'Luz', '光线'],
  'Exposure': ['Exposition', 'Belichtung', 'Exposición', '曝光'],
  'Contrast': ['Contraste', 'Kontrast', 'Contraste', '对比度'],
  'Highlights': ['Hautes lumières', 'Lichter', 'Luces', '高光'],
  'Shadows': ['Ombres', 'Tiefen', 'Sombras', '阴影'],
  'Whites': ['Blancs', 'Weiß', 'Blancos', '白色色阶'],
  'Blacks': ['Noirs', 'Schwarz', 'Negros', '黑色色阶'],
  'Vibrance': ['Vibrance', 'Dynamik', 'Intensidad', '自然饱和度'],
  'Temp': ['Température', 'Temperatur', 'Temperatura', '色温'],
  'Tint': ['Teinte', 'Tönung', 'Matiz', '色调'],
  'Clarity': ['Clarté', 'Klarheit', 'Claridad', '清晰度'],
  'Dehaze': ['Correction du voile', 'Dunst entfernen', 'Quitar neblina', '去雾'],
  'Sharpness': ['Netteté', 'Schärfe', 'Nitidez', '锐度'],
  'Vignette': ['Vignettage', 'Vignette', 'Viñeta', '暗角'],
  'Grain': ['Grain', 'Körnung', 'Grano', '颗粒'],
  'Red': ['Rouge', 'Rot', 'Rojo', '红色'],
  'Orange': ['Orange', 'Orange', 'Naranja', '橙色'],
  'Yellow': ['Jaune', 'Gelb', 'Amarillo', '黄色'],
  'Green': ['Vert', 'Grün', 'Verde', '绿色'],
  'Aqua': ['Turquoise', 'Aquamarin', 'Aguamarina', '青色'],
  'Blue': ['Bleu', 'Blau', 'Azul', '蓝色'],
  'Purple': ['Violet', 'Lila', 'Morado', '紫色'],
  'Magenta': ['Magenta', 'Magenta', 'Magenta', '洋红'],
  'Luminance': ['Luminance', 'Luminanz', 'Luminancia', '明亮度'],
  'Draw': ['Dessin', 'Zeichnen', 'Dibujo', '绘画'],
  'Fill': ['Remplissage', 'Füllen', 'Relleno', '填充'],
  'clear': ['effacer', 'löschen', 'borrar', '清除'],
  'Paint over small details to hide them - drag on the photo to draw.': ['Peignez sur de petits détails pour les masquer : faites glisser sur la photo pour dessiner.', 'Malen Sie über kleine Details, um sie zu verdecken: auf dem Foto ziehen zum Zeichnen.', 'Pinta sobre pequeños detalles para ocultarlos: arrastra sobre la foto para dibujar.', '涂抹小细节以遮盖它们:在照片上拖动即可绘画。'],
  'Highlighter': ['Surligneur', 'Textmarker', 'Rotulador', '荧光笔'],
  'Paint bucket': ['Pot de peinture', 'Farbeimer', 'Bote de pintura', '油漆桶'],
  'Eraser': ['Gomme', 'Radierer', 'Borrador', '橡皮擦'],
  'Undo stroke': ['Annuler le trait', 'Strich rückgängig', 'Deshacer trazo', '撤销笔画'],
  'Clear drawing': ['Effacer le dessin', 'Zeichnung löschen', 'Borrar dibujo', '清除绘画'],
  'A solid stroke in the current colour.': ['Un trait plein dans la couleur choisie.', 'Ein deckender Strich in der aktuellen Farbe.', 'Un trazo sólido del color actual.', '当前颜色的实心笔画。'],
  'A wide translucent marker that tints instead of covering. One stroke stays an even tone however much it crosses itself.': ['Un large marqueur translucide qui teinte au lieu de couvrir. Un trait garde un ton uniforme même s\'il se croise.', 'Ein breiter, durchscheinender Marker, der tönt statt zu decken. Ein Strich bleibt gleichmäßig, auch wenn er sich kreuzt.', 'Un rotulador ancho y translúcido que tiñe en vez de cubrir. Un trazo mantiene un tono uniforme aunque se cruce.', '宽而半透明的马克笔,只染色不覆盖。一笔无论如何交叉都保持均匀色调。'],
  'Click to flood the area under the cursor with the current colour.': ['Cliquez pour remplir la zone sous le curseur avec la couleur choisie.', 'Klicken, um den Bereich unter dem Mauszeiger mit der aktuellen Farbe zu füllen.', 'Haz clic para rellenar la zona bajo el cursor con el color actual.', '点击即可用当前颜色填充光标下的区域。'],
});

UI_PATTERNS.push(
  [/^(\d+) memor(?:y|ies)$/, ['$1 souvenir(s)', '$1 Erinnerung(en)', '$1 recuerdo(s)', '$1 个回忆']],
  [/^(\d+) layers?$/, ['$1 calque(s)', '$1 Ebene(n)', '$1 capa(s)', '$1 个图层']],
);
