/**
 * Worked examples for the prompt, one set per language: a person and an object.
 * Each keyword is { t: text, s?: stem (languages whose stems come from the model), f?: extra forms
 * (languages with a `forms` flag: genitive singular / nominative plural or the closest equivalents) }.
 */
export const EXAMPLE_ENTRIES = [
    { uid: 'example-1', title: 'Elara', keys: ['Elara'], content: 'The innkeeper of the Drunken Pony, a retired adventurer with a scar over one eye.' },
    { uid: 'example-2', title: 'Healing Potion', keys: ['healing potion', 'potion'], content: 'A red tonic that closes wounds within minutes.' },
];

export const EXAMPLE_KEYWORDS = {
    ru: [
        [{ t: 'Элара', f: ['Элары'] }, { t: 'трактирщица', f: ['трактирщицы'] }, { t: 'хозяйка таверны', f: ['хозяйки таверны'] }],
        [{ t: 'зелье лечения', f: ['зелья лечения'] }, { t: 'зелье', f: ['зелья', 'зелий'] }, { t: 'лечебное зелье', f: ['лечебного зелья'] }, { t: 'целебный эликсир', f: ['целебного эликсира'] }, { t: 'хилка', f: ['хилки', 'хилок'] }],
    ],
    uk: [
        [{ t: 'Елара', s: 'Елар', f: ['Елари'] }, { t: 'трактирниця', s: 'трактирниц', f: ['трактирниці'] }, { t: 'господиня таверни', s: 'господин таверн', f: ['господині таверни'] }],
        [{ t: 'зілля лікування', s: 'зілл лікуванн' }, { t: 'зілля', s: 'зілл', f: ['зіллю'] }, { t: 'цілюще зілля', s: 'цілющ зілл', f: ['цілющого зілля'] }, { t: 'еліксир', s: 'еліксир', f: ['еліксиру', 'еліксири'] }],
    ],
    de: [
        [{ t: 'Elara' }, { t: 'Wirtin', f: ['Wirtinnen'] }, { t: 'Schankwirtin', f: ['Schankwirtinnen'] }, { t: 'Gastwirtin', f: ['Gastwirtinnen'] }],
        [{ t: 'Heiltrank', f: ['Heiltranks', 'Heiltränke'] }, { t: 'Trank', f: ['Tranks', 'Tränke'] }, { t: 'Heilelixier', f: ['Heilelixiere'] }, { t: 'Heilmittel', f: ['Heilmittels'] }],
    ],
    fr: [
        [{ t: 'Elara' }, { t: 'aubergiste' }, { t: 'tenancière' }, { t: 'patronne' }],
        [{ t: 'potion de soin' }, { t: 'potion' }, { t: 'élixir de soin' }, { t: 'remède' }],
    ],
    es: [
        [{ t: 'Elara' }, { t: 'posadera' }, { t: 'tabernera' }, { t: 'dueña de la taberna' }],
        [{ t: 'poción de curación' }, { t: 'poción' }, { t: 'elixir curativo' }, { t: 'pócima' }],
    ],
    pt: [
        [{ t: 'Elara' }, { t: 'estalajadeira' }, { t: 'taberneira' }, { t: 'dona da taverna' }],
        [{ t: 'poção de cura' }, { t: 'poção' }, { t: 'elixir de cura' }, { t: 'remédio' }],
    ],
    it: [
        [{ t: 'Elara' }, { t: 'locandiera' }, { t: 'ostessa' }, { t: 'padrona della taverna' }],
        [{ t: 'pozione curativa' }, { t: 'pozione' }, { t: 'elisir di guarigione' }, { t: 'rimedio' }],
    ],
    pl: [
        [{ t: 'Elara', s: 'Elar', f: ['Elary'] }, { t: 'karczmarka', s: 'karczmar', f: ['karczmarki', 'karczmarek'] }, { t: 'oberżystka', s: 'oberżyst', f: ['oberżystki'] }, { t: 'właścicielka karczmy', s: 'właściciel karczm', f: ['właścicielki karczmy'] }],
        [{ t: 'mikstura lecznicza', s: 'mikstur leczni', f: ['mikstury leczniczej'] }, { t: 'mikstura', s: 'mikstur', f: ['mikstury'] }, { t: 'eliksir leczniczy', s: 'eliksir leczni', f: ['eliksiru leczniczego'] }, { t: 'lekarstwo', s: 'lekarstw', f: ['lekarstwa'] }],
    ],
    cs: [
        [{ t: 'Elara', f: ['Elary'] }, { t: 'hostinská', f: ['hostinské'] }, { t: 'krčmářka', f: ['krčmářky', 'krčmářek'] }, { t: 'majitelka hospody', f: ['majitelky hospody'] }],
        [{ t: 'léčivý lektvar', f: ['léčivého lektvaru'] }, { t: 'lektvar', f: ['lektvaru', 'lektvary'] }, { t: 'elixír', f: ['elixíru'] }, { t: 'léčivo', f: ['léčiva'] }],
    ],
    sk: [
        [{ t: 'Elara', s: 'Elar' }, { t: 'krčmárka', s: 'krčmár' }, { t: 'hostinská', s: 'hostinsk' }, { t: 'majiteľka krčmy', s: 'majiteľ krčm' }],
        [{ t: 'liečivý elixír', s: 'liečiv elixír' }, { t: 'elixír', s: 'elixír' }, { t: 'odvar', s: 'odvar' }, { t: 'liek', s: 'liek' }],
    ],
    hu: [
        [{ t: 'Elara', f: ['Elarát'] }, { t: 'kocsmárosné', f: ['kocsmárosnét'] }, { t: 'fogadósné' }, { t: 'kocsmáros', f: ['kocsmárost', 'kocsmárosok'] }],
        [{ t: 'gyógyital', f: ['gyógyitalt', 'gyógyitalok'] }, { t: 'bájital', f: ['bájitalt'] }, { t: 'gyógyfőzet', f: ['gyógyfőzetet'] }, { t: 'elixír', f: ['elixírt', 'elixírek'] }],
    ],
    id: [
        [{ t: 'Elara' }, { t: 'pemilik penginapan' }, { t: 'pemilik kedai' }, { t: 'penjaga kedai' }],
        [{ t: 'ramuan penyembuh' }, { t: 'ramuan' }, { t: 'obat', f: ['pengobatan', 'mengobati'] }, { t: 'eliksir penyembuh' }],
    ],
    ja: [
        [{ t: 'エララ' }, { t: '女将' }, { t: '宿屋の女主人' }, { t: '酒場の主人' }],
        [{ t: '回復薬' }, { t: 'ポーション' }, { t: '治癒の薬' }, { t: '霊薬' }],
    ],
    zh: [
        [{ t: '艾拉拉' }, { t: '老板娘' }, { t: '酒馆老板娘' }, { t: '客栈老板' }],
        [{ t: '治疗药水' }, { t: '药水' }, { t: '回复药' }, { t: '灵药' }],
    ],
};
