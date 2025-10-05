const { useState, useRef, useEffect, useCallback, useMemo } = React;
const { motion } = FramerMotion;

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

const fetchWithRetry = (url, options, retries = 5, backoff = 1000) => {
    return new Promise((resolve, reject) => {
        const attempt = async (retryCount, delay) => {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('API Error:', errorData);
                    if (response.status === 429 && retryCount > 0) {
                        console.log(`Rate limited. Retrying in ${delay / 1000}s...`);
                        setTimeout(() => attempt(retryCount - 1, delay * 2), delay);
                    } else if (response.status === 401) {
                        reject(new Error(`API request failed with status 401: Unauthorized. Please ensure your API key is valid.`));
                    }
                    else {
                        reject(new Error(`API request failed with status ${response.status}: ${errorData.error?.message || 'Unknown error'}`));
                    }
                } else {
                    resolve(response.json());
                }
            } catch (error) {
                if (retryCount > 0) {
                    console.log(`Request failed. Retrying in ${delay / 1000}s...`, error);
                    setTimeout(() => attempt(retryCount - 1, delay * 2), delay);
                } else {
                    reject(error);
                }
            }
        };
        attempt(retries, backoff);
    });
};

const cropImage = (imageUrl, aspectRatio) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let sourceX, sourceY, sourceWidth, sourceHeight;
        const originalWidth = img.width;
        const originalHeight = img.height;
        const originalAspectRatio = originalWidth / originalHeight;

        const [targetW, targetH] = aspectRatio.split(':').map(Number);
        const targetAspectRatio = targetW / targetH;

        if (originalAspectRatio > targetAspectRatio) {
            sourceHeight = originalHeight;
            sourceWidth = originalHeight * targetAspectRatio;
            sourceX = (originalWidth - sourceWidth) / 2;
            sourceY = 0;
        } else {
            sourceWidth = originalWidth;
            sourceHeight = originalWidth / targetAspectRatio;
            sourceY = (originalHeight - sourceHeight) / 2;
            sourceX = 0;
        }

        canvas.width = sourceWidth;
        canvas.height = sourceHeight;

        ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
        resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (err) => reject(err);
});

const generateDynamicPrompt = async (themeDescription) => {
    console.log("Generating dynamic prompt (using fallback) for:", themeDescription);
    await new Promise(resolve => setTimeout(resolve, 1500));
    return "A retro 80s studio background with laser beams, neon geometric shapes, fog, and dramatic backlighting.";
};


const generateImageWithRetry = async (payload, totalAttempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        try {
            const apiKey = "";

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;
            
            const result = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

            if (base64Data) {
                return `data:image/png;base64,${base64Data}`;
            }

            lastError = new Error("API returned no image data.");
            console.warn(`Attempt ${attempt}/${totalAttempts}: ${lastError.message}`);

        } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt}/${totalAttempts} failed:`, error);
        }

        if (attempt < totalAttempts) {
            const delay = 2500 * Math.pow(2, attempt - 1);
            console.log(`Waiting ${delay / 1000}s before next attempt...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }

    throw new Error(`Image generation failed after ${totalAttempts} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
};

const createSingleFramedImage = (imageUrl, cropRatio, labelText = null) => new Promise(async (resolve, reject) => {
    try {
        const croppedImgUrl = await cropImage(imageUrl, cropRatio);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = croppedImgUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const hasLabel = !!labelText;
            const sidePadding = img.width * 0.04;
            const topPadding = img.width * 0.04;
            let bottomPadding = img.width * 0.18;

            if(hasLabel) {
                bottomPadding = img.width * 0.24;
            }
            
            canvas.width = img.width + sidePadding * 2;
            canvas.height = img.height + topPadding + bottomPadding;

            ctx.fillStyle = '#111827';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.drawImage(img, sidePadding, topPadding);

            if (hasLabel) {
                 const labelFontSize = Math.max(24, Math.floor(img.width * 0.08));
                 ctx.font = `700 ${labelFontSize}px Caveat, cursive`;
                 ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
                 ctx.textAlign = 'center';
                 ctx.textBaseline = 'middle';
                 ctx.fillText(labelText, canvas.width / 2, img.height + topPadding + (bottomPadding - img.width * 0.1) / 2);
            }

            const fontSize = Math.max(12, Math.floor(img.width * 0.05));
            ctx.font = `600 ${fontSize}px Inter, sans-serif`;
            ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("Made with Gemini", canvas.width / 2, canvas.height - (img.width * 0.11));

            const nanoFontSize = Math.max(8, Math.floor(img.width * 0.035));
            ctx.font = `600 ${nanoFontSize}px Inter, sans-serif`;
            ctx.fillText("Edit your images with Nano Banana at gemini.google", canvas.width / 2, canvas.height - (img.width * 0.05));

            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
    } catch(err) {
        reject(err);
    }
});


const getModelInstruction = (template, prompt, options) => {
    const {
        headshotExpression, headshotPose,
        currentAlbumStyle,
        hairColors,
    } = options;

    switch (template) {
        case 'decades':
            return `The highest priority is to maintain the exact facial features, likeness, perceived gender, framing, and composition of the person in the provided reference photo. Keeping the original photo's composition, change the person's hair, clothing, and accessories, as well as the photo's background, to match the style of the ${prompt.id}. Do not alter the person's core facial structure.`;
        case 'impossibleSelfies':
            return `The highest priority is to maintain the exact facial features, likeness, and perceived gender of the person in the provided reference photo. Keeping the original photo's composition as much as possible, place the person into the following scene, changing their clothing, hair, and the background to match: ${prompt.base}. Do not alter the person's core facial structure.`;
        case 'hairStyler': {
            let instruction = `The highest priority is to maintain the exact facial features, likeness, and perceived gender of the person in the provided reference photo. Keeping the original photo's composition, style the person's hair to be a perfect example of ${prompt.base}. If the person's hair already has this style, enhance and perfect it. Do not alter the person's core facial structure, clothing, or the background.`;

            if (['Short', 'Medium', 'Long'].includes(prompt.id)) {
                instruction += " Maintain the person's original hair texture (e.g., straight, wavy, curly).";
            }

            if (hairColors && hairColors.length > 0) {
                if (hairColors.length === 1) {
                    instruction += ` The hair color should be ${hairColors[0]}.`;
                } else if (hairColors.length === 2) {
                    instruction += ` The hair should be a mix of two colors: ${hairColors[0]} and ${hairColors[1]}.`;
                }
            }
            return instruction;
        }
        case 'headshots': {
            const poseInstruction = headshotPose === 'Forward' ? 'facing forward towards the camera' : 'posed at a slight angle to the camera';
            return `The highest priority is to maintain the exact facial features, likeness, and perceived gender of the person in the provided reference photo. Transform the image into a professional headshot. The person should be ${poseInstruction} with a "${headshotExpression}" expression. They should be ${prompt.base}. Please maintain the original hairstyle from the photo. The background should be a clean, neutral, out-of-focus studio background (like light gray, beige, or white). Do not alter the person's core facial structure. The final image should be a well-lit, high-quality professional portrait.`;
        }
        case 'eightiesMall':
            return `The highest priority is to maintain the exact facial features, likeness, and perceived gender of the person in the provided reference photo. Transform the image into a photo from a single 1980s mall photoshoot. The overall style for the entire photoshoot is: "${currentAlbumStyle}". For this specific photo, the person should be in ${prompt.base}. The person's hair and clothing should be 80s style and be consistent across all photos in this set. The background and lighting must also match the overall style for every photo.`;
        case 'styleLookbook': {
            const finalStyle = options.lookbookStyle === 'Other' ? options.customLookbookStyle : options.lookbookStyle;
            return `The highest priority is to maintain the exact facial features, likeness, and perceived gender of the person in the provided reference photo. Transform the image into a high-fashion lookbook photo. The overall fashion style for the entire lookbook is "${finalStyle}". For this specific photo, create a unique, stylish outfit that fits the overall style, and place the person in ${prompt.base} in a suitable, fashionable setting. The person's hair and makeup should also complement the style. Each photo in the lookbook should feature a different outfit. Do not alter the person's core facial structure.`;
        }
        case 'figurines':
            return `The highest priority is to maintain the exact facial features and likeness of the person in the provided reference photo. Transform the person into a miniature figurine based on the following description, placing it in a realistic environment: ${prompt.base}. The final image should look like a real photograph of a physical object. Do not alter the person's core facial structure.`;
        default:
            return `Create an image based on the reference photo and this prompt: ${prompt.base}`;
    }
};

const IconUpload = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-10 h-10' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' }));
const IconSparkles = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-6 h-6' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z' }));
const IconOptions = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-6 h-6' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z' }));
const IconSearch = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-5 h-5' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z' }));
const IconDownload = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-5 h-5' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3' }));
const IconCamera = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-6 h-6' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z' }), React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z' }));
const IconPlus = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-5 h-5' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4.5v15m7.5-7.5h-15' }));
const IconX = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor', className: 'w-5 h-5' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6 18 18 6M6 6l12 12' }));
const IconRegenerate = () => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor', className: 'w-6 h-6' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M16.023 16.023A7.5 7.5 0 1 0 8.25 8.25V6.75a.75.75 0 0 1 1.5 0v3.75a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1 0-1.5h2.37a5.98 5.98 0 0 1 8.403 8.403Z' }));

const Button = ({ children, onClick, disabled, primary = false, className = '' }) => {
    const baseClass = "px-6 py-2 rounded-md font-semibold tracking-wider uppercase transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed";
    const themeClass = primary 
        ? "bg-yellow-400 text-black hover:bg-yellow-300" 
        : "bg-transparent border border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white";
    
    return (
        React.createElement('button', {
            onClick: onClick,
            disabled: disabled,
            className: `${baseClass} ${themeClass} ${className}`
        }, children)
    );
};

const PhotoDisplay = ({ era, imageUrl, onDownload, onRegenerate, isPolaroid = true, index=0, showLabel = true }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const rotation = useMemo(() => {
        if (!isPolaroid) return 'rotate-0';
        const rotations = ['rotate-1', '-rotate-1', 'rotate-0.5', '-rotate-1.5'];
        return rotations[index % rotations.length];
    }, [index, isPolaroid]);

    const containerClass = isPolaroid
            ? `relative group bg-gray-100 p-3 pb-12 shadow-xl transform transition-all duration-300 hover:shadow-2xl hover:scale-105 ${rotation}`
            : 'relative group pb-4 bg-gray-900 rounded-xl shadow-lg transition-all duration-300 hover:shadow-2xl hover:scale-105';
    
    const imageContainerClass = isPolaroid
            ? 'aspect-square bg-gray-200'
            : 'rounded-t-xl overflow-hidden';

    const textClass = isPolaroid
        ? 'text-center mt-4 font-caveat text-3xl text-gray-900 absolute bottom-3 left-0 right-0'
        : 'text-center mt-3 text-lg font-semibold text-gray-300 px-3';

    return (
        React.createElement(motion.div, {
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.5 },
            className: containerClass
        }, 
            React.createElement('div', { className: imageContainerClass }, 
                React.createElement('img', { src: imageUrl, alt: `You in ${era}`, className: `w-full ${isPolaroid ? 'h-full object-cover' : 'h-auto'}` })
            ),
            showLabel && React.createElement('p', { className: textClass }, era),
            React.createElement('div', { className: "absolute top-3 right-3 z-10", ref: menuRef },
                React.createElement('button', {
                    onClick: () => setIsMenuOpen(!isMenuOpen),
                    className: "p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm shadow-lg",
                    'aria-label': "Options"
                }, React.createElement(IconOptions, null)),
                isMenuOpen && React.createElement(motion.div, {
                    initial: { opacity: 0, scale: 0.95 },
                    animate: { opacity: 1, scale: 1 },
                    transition: { duration: 0.1 },
                    className: "absolute right-0 top-12 mt-2 w-48 origin-top-right bg-black/80 backdrop-blur-md rounded-lg shadow-2xl ring-1 ring-white/10 text-white text-sm flex flex-col p-1"
                }, 
                    React.createElement('span', { className: "w-full text-left px-3 pt-2 pb-1 text-xs text-gray-500 uppercase tracking-wider" }, "Actions"),
                    React.createElement('button', { onClick: () => { onRegenerate(); setIsMenuOpen(false); }, className: "w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors" }, "Regenerate"),
                    React.createElement('div', { className: "my-1 h-px bg-white/10" }),
                    React.createElement('span', { className: "w-full text-left px-3 pt-1 pb-1 text-xs text-gray-500 uppercase tracking-wider" }, "Download"),
                    React.createElement('button', { onClick: () => { onDownload(imageUrl, era, '1:1'); setIsMenuOpen(false); }, className: "w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors" }, "Square (1:1)"),
                    React.createElement('button', { onClick: () => { onDownload(imageUrl, era, '9:16'); setIsMenuOpen(false); }, className: "w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors" }, "Portrait (9:16)")
                )
            )
        )
    );
};

const SkeletonLoader = ({ className }) => React.createElement('div', { className: `animate-pulse bg-gray-800 ${className}` });

const LoadingCard = ({ era, isPolaroid = true, showLabel = true }) => {
    const containerClass = isPolaroid
        ? 'relative bg-gray-100 p-3 pb-12 shadow-md'
        : 'pb-4 bg-gray-900 rounded-xl shadow-md';

    const loaderClass = isPolaroid
        ? 'aspect-square'
        : 'aspect-[3/4] rounded-t-xl';
    
    return (
        React.createElement('div', { className: containerClass },
            React.createElement(SkeletonLoader, { className: loaderClass }),
            isPolaroid && showLabel && (
                React.createElement('div', { className: "absolute bottom-3 left-0 right-0 flex justify-center" },
                     React.createElement(SkeletonLoader, { className: "h-6 w-3/4 rounded-md bg-gray-300" })
                )
            ),
            !isPolaroid && showLabel && (
                 React.createElement('div', { className: "mt-3 flex justify-center" },
                    React.createElement(SkeletonLoader, { className: "h-5 w-1/2 rounded-md" })
                )
            ),
            React.createElement('div', { className: "absolute inset-0 flex items-center justify-center" },
                React.createElement('div', { className: "animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-400" })
            )
        )
    );
};

const ErrorCard = ({ era, isPolaroid = true, onRegenerate, showLabel = true }) => {
     const containerClass = isPolaroid
        ? 'relative group bg-gray-100 p-3 pb-12 shadow-md'
        : 'pb-4 bg-gray-900 rounded-xl shadow-md';

    const errorContainerClass = isPolaroid
        ? 'aspect-square bg-gray-200 border-2 border-dashed border-red-500/50'
        : 'rounded-t-xl bg-gray-800 border-2 border-dashed border-red-500/50 aspect-[3/4]';
    
    const textClass = isPolaroid
        ? 'text-center mt-4 font-caveat text-3xl text-gray-900 absolute bottom-3 left-0 right-0'
        : 'text-center mt-3 text-lg font-semibold text-gray-300 px-3';

    return (
        React.createElement('div', {
            className: `relative transition-all duration-500 ease-in-out group ${containerClass} `
        },
            React.createElement('div', { 
                className: `flex flex-col items-center justify-center text-center p-4 ${errorContainerClass}`
            },
                React.createElement('p', { className: "text-red-400 font-medium mb-4" }, "Generation failed"),
                onRegenerate && React.createElement(Button, { onClick: onRegenerate, primary: true }, "Retry")
            ),
            showLabel && React.createElement('p', { className: textClass }, era)
        )
    );
};

const ErrorNotification = ({ message, onDismiss }) => {
    if (!message) return null;
    return (
        React.createElement('div', { 
            className: "fixed top-5 left-1/2 z-50 w-full max-w-md p-4 bg-gray-900 border border-gray-700 text-gray-300 rounded-lg shadow-2xl flex items-center justify-between animate-fade-in-down", 
            style: { transform: 'translateX(-50%)' } 
        },
            React.createElement('span', null, message),
            React.createElement('button', { onClick: onDismiss, className: "p-1 rounded-full hover:bg-gray-800 transition-colors ml-4" },
                React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className: "text-gray-500" }, 
                    React.createElement('line', { x1: "18", y1: "6", x2: "6", y2: "18" }),
                    React.createElement('line', { x1: "6", y1: "6", x2: "18", y2: "18" })
                )
            )
        )
    );
};

const CameraModal = ({ isOpen, onClose, onCapture }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [capturedImage, setCapturedImage] = useState(null);
    const [cameraError, setCameraError] = useState(null);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    const startCamera = useCallback(async () => {
        if (videoRef.current) {
            setCameraError(null);
            try {
                stopCamera();
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1024 }, height: { ideal: 1024 }, facingMode: 'user' }
                });
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
            } catch (err) {
                console.error("Error accessing camera:", err);
                setCameraError("Camera access denied. Please allow camera access in your browser settings.");
            }
        }
    }, [stopCamera]);

    useEffect(() => {
        if (isOpen && !capturedImage) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => {
            stopCamera();
        };
    }, [isOpen, capturedImage, startCamera, stopCamera]);


    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            context.scale(-1, 1);
            context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            setCapturedImage(dataUrl);
        }
    };

    const handleConfirm = () => {
        if (capturedImage) {
            onCapture(capturedImage);
            onClose();
        }
    };

    const handleRetake = () => {
        setCapturedImage(null);
    };

    if (!isOpen) return null;

    return (
        React.createElement('div', { className: "fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" },
             React.createElement(motion.div, {
                initial: { opacity: 0, scale: 0.95 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.2 },
                className: "bg-gray-900 rounded-2xl p-6 border border-gray-700 shadow-2xl w-full max-w-2xl text-center relative"
             },
                React.createElement('h3', { className: "text-2xl font-semibold mb-4 text-white" }, "Camera"),
                React.createElement('div', { className: "aspect-square bg-black rounded-lg overflow-hidden relative mb-4 flex items-center justify-center" },
                    cameraError ? (
                        React.createElement('div', { className: "p-4 text-red-400" }, cameraError)
                    ) : (
                        React.createElement(React.Fragment, null,
                            capturedImage ? (
                                React.createElement('img', { src: capturedImage, alt: "Captured preview", className: "w-full h-full object-cover" })
                            ) : (
                                React.createElement('video', { ref: videoRef, autoPlay: true, playsInline: true, className: "w-full h-full object-cover transform -scale-x-100" })
                            )
                        )
                    )
                ),
                React.createElement('div', { className: "flex justify-center gap-4" },
                    capturedImage ? (
                        React.createElement(React.Fragment, null,
                            React.createElement(Button, { onClick: handleRetake }, "Retake"),
                            React.createElement(Button, { onClick: handleConfirm, primary: true }, "Use Photo")
                        )
                    ) : (
                         React.createElement('button', { onClick: handleCapture, disabled: !!cameraError, className: "w-20 h-20 rounded-full bg-white border-4 border-gray-600 focus:outline-none focus:ring-4 focus:ring-yellow-400 transition-all hover:border-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed" })
                    )
                ),
                React.createElement('button', { onClick: onClose, className: "absolute top-4 right-4 p-2 rounded-full bg-gray-800/70 text-white hover:bg-gray-700 transition-colors" },
                    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", className: "w-6 h-6" },
                        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M6 18 18 6M6 6l12 12" })
                    )
                ),
                React.createElement('canvas', { ref: canvasRef, className: "hidden" })
            )
        )
    );
};

const RadioPill = ({ name, value, label, checked, onChange }) => (
    React.createElement('label', { className: `cursor-pointer px-3 py-1.5 text-sm rounded-full transition-colors font-semibold 
        ${checked ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}` },
        React.createElement('input', {
            type: "radio",
            name: name,
            value: value,
            checked: checked,
            onChange: onChange,
            className: "hidden"
        }),
        label
    )
);

const TemplateCard = ({ id, name, icon, description, isSelected, onSelect }) => (
    React.createElement('div', {
        onClick: () => onSelect(id),
        className: `cursor-pointer p-5 rounded-xl border-2 transition-all duration-300 transform hover:scale-105 shadow-lg
        ${isSelected ? 'border-yellow-400 bg-yellow-900/20 ring-1 ring-yellow-400' : 'border-gray-700 bg-gray-900 hover:border-gray-600'}`
    },
        React.createElement('div', { className: "text-3xl mb-3" }, icon),
        React.createElement('h3', { className: "text-lg font-semibold text-white" }, name),
        React.createElement('p', { className: "text-sm text-gray-400 mt-1" }, description)
    )
);


const App = () => {
    const [uploadedImage, setUploadedImage] = useState(null);
    const [generatedImages, setGeneratedImages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSettingUp, setIsSettingUp] = useState(false);
    const [isDownloadingAlbum, setIsDownloadingAlbum] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const resultsRef = useRef(null);
    const [template, setTemplate] = useState(null);
    const [currentAlbumStyle, setCurrentAlbumStyle] = useState('');
    const [hairColors, setHairColors] = useState([]);
    const [selectedHairStyles, setSelectedHairStyles] = useState([]);
    const [customHairStyle, setCustomHairStyle] = useState('');
    const [isCustomHairActive, setIsCustomHairActive] = useState(false);
    const [lookbookStyle, setLookbookStyle] = useState('');
    const [customLookbookStyle, setCustomLookbookStyle] = useState('');
    const [headshotExpression, setHeadshotExpression] = useState('Friendly Smile');
    const [headshotPose, setHeadshotPose] = useState('Forward');

    const handleColorChange = (index, newColor) => {
        setHairColors(prev => {
            const newColors = [...prev];
            newColors[index] = newColor;
            return newColors;
        });
    };

    const addHairColor = () => {
        if (hairColors.length < 2) {
            setHairColors(prev => [...prev, '#4a2c20']);
        }
    };

    const removeHairColor = (index) => {
        setHairColors(prev => prev.filter((_, i) => i !== index));
    };

    const handleHairStyleSelect = (styleId) => {
        if (styleId === 'Other') {
            setIsCustomHairActive(prev => {
                const isActivating = !prev;
                if (isActivating && selectedHairStyles.length >= 6) {
                    setError("You can select a maximum of 6 styles.");
                    return prev;
                }
                if (!isActivating) setCustomHairStyle('');
                return isActivating;
            });
            return;
        }
    
        setSelectedHairStyles(prev => {
            const isSelected = prev.includes(styleId);
            const totalSelected = prev.length + (isCustomHairActive ? 1 : 0);
            
            if (isSelected) {
                return prev.filter(s => s !== styleId);
            }
            
            if (totalSelected < 6) {
                return [...prev, styleId];
            }
            
            setError("You can select a maximum of 6 styles.");
            return prev;
        });
    };

    const templates = useMemo(() => ({
        decades: {
            name: 'Time Traveler',
            description: 'See yourself through the decades.',
            icon: '⏳',
            isPolaroid: true,
            prompts: [
                { id: '1950s', base: 'A 1950s style portrait.' },
                { id: '1960s', base: 'A 1960s style portrait.' },
                { id: '1970s', base: 'A 1970s style portrait.' },
                { id: '1980s', base: 'An 1980s style portrait.' },
                { id: '1990s', base: 'A 1990s style portrait.' },
                { id: '2000s', base: 'A 2000s style portrait.' },
            ]
        },
        styleLookbook: {
            name: "Style Lookbook",
            description: "Your personal fashion photoshoot.",
            icon: '👗',
            isPolaroid: false,
            styles: [
                'Classic / Casual', 'Streetwear', 'Vintage', 'Goth', 'Preppy', 'Minimalist', 
                'Athleisure', 'Old Money / Quiet Luxury', 'Bohemian (Boho)', 'Business Casual', 
                '90s Grunge', 'Cocktail / Formal'
            ],
            prompts: [
                { id: 'Look 1', base: 'a full-body shot, standing' },
                { id: 'Look 2', base: 'a half-body shot, smiling' },
                { id: 'Look 3', base: 'a candid walking shot' },
                { id: 'Look 4', base: 'a shot showing off outfit details' },
                { id: 'Look 5', base: 'a seated pose' },
                { id: 'Look 6', base: 'a close-up shot focusing on accessories' },
            ]
        },
        eightiesMall: {
            name: "'80s Mall Shoot",
            description: "Totally tubular 1980s portraits.",
            icon: '📼',
            isPolaroid: false,
            prompts: [
                { id: 'Smiling', base: 'a friendly, smiling pose' },
                { id: 'Thoughtful', base: 'a thoughtful, looking away from the camera pose' },
                { id: 'Fun', base: 'a fun, laughing pose' },
                { id: 'Serious', base: 'a serious, dramatic pose' },
                { id: 'Hand on Chin', base: 'posing with their hand on their chin' },
                { id: 'Over the Shoulder', base: 'looking back over their shoulder' },
            ]
        },
        figurines: {
            name: 'Miniature Me',
            description: 'Your own collectible figurines.',
            icon: '🧍‍♂️',
            isPolaroid: false,
            prompts: [
                { id: 'Bobblehead', base: 'A realistic bobblehead figure of the person with an oversized head, displayed on a polished wooden desk next to a computer keyboard.' },
                { id: 'Porcelain Figurine', base: 'A delicate souvenir porcelain figurine of the person, painted with glossy colors, sitting on a lace doily on a vintage dresser.' },
                { id: 'Retro Action Figure', base: 'A retro 1980s-style action figure of the person, complete with articulated joints and slightly worn paint, posed in a dynamic stance on a rocky diorama base.' },
                { id: 'Vinyl Figure', base: 'A stylized collectible vinyl art toy of the person with minimalist features, standing on a shelf filled with other similar toys.' },
                { id: 'Plushy Figure', base: 'A soft, cute plushy figure of the person with detailed fabric texture and stitching, sitting on a neatly made bed.' },
                { id: 'Wooden Folk Art', base: 'A hand-carved wooden folk art figure of the person, painted with rustic, charming details, standing on a simple wooden block on a craft fair table.' },
            ]
        },
        hairStyler: {
            name: 'Hair Styler',
            description: 'Try on new hairstyles and colors.',
            icon: '💇‍♀️',
            isPolaroid: false,
            prompts: [
                { id: 'Short', base: 'a short hairstyle' },
                { id: 'Medium', base: 'a medium-length hairstyle' },
                { id: 'Long', base: 'a long hairstyle' },
                { id: 'Straight', base: 'straight hair' },
                { id: 'Wavy', base: 'wavy hair' },
                { id: 'Curly', base: 'curly hair' },
            ]
        },
        impossibleSelfies: {
            name: 'Impossible Pics',
            description: 'Photos that defy reality.',
            icon: '🚀',
            isPolaroid: false,
            prompts: [
                { id: 'With Lincoln', base: 'The person posing with Abraham Lincoln, who is also making a peace sign and sticking his tongue out. Keep the original location.' },
                { id: 'Alien & Bubbles', base: 'The person posing next to a realistic alien holding two bubble guns, blowing thousands of bubbles. Keep the person\'s pose and the original location.' },
                { id: 'Room of Puppies', base: 'The person posing in a room filled with a hundred different puppies.' },
                { id: 'Singing Puppets', base: 'The person posing in a room full of large, whimsical, brightly colored felt puppets that are singing.' },
                { id: 'Giant Chicken Tender', base: 'The person posing with their arm around a 4-foot-tall chicken tender. Keep the person\'s facial expression exactly the same.' },
                { id: 'Yeti Photobomb', base: 'Add a realistic yeti standing next to the person on the left side of the photo, matching the lighting. Keep the person\'s pose and face exactly the same.' },
            ]
        },
        headshots: {
            name: "Pro Headshots",
            description: "Professional profile pictures.",
            icon: '💼',
            isPolaroid: false,
            prompts: [
                { id: 'Business Suit', base: 'wearing a dark business suit with a crisp white shirt' },
                { id: 'Smart Casual', base: 'wearing a smart-casual knit sweater over a collared shirt' },
                { id: 'Creative Pro', base: 'wearing a dark turtleneck' },
                { id: 'Corporate Look', base: 'wearing a light blue button-down shirt' },
                { id: 'Bright & Modern', base: 'wearing a colorful blazer' },
                { id: 'Relaxed', base: 'wearing a simple, high-quality t-shirt under a casual jacket' },
            ]
        },
    }), []);

    const regenerateImageAtIndex = async (imageIndex) => {
        const imageToRegenerate = generatedImages[imageIndex];
        if (!imageToRegenerate) return;
    
        setGeneratedImages(prev => prev.map((img, index) =>
            index === imageIndex ? { ...img, status: 'pending' } : img
        ));
        setError(null);
    
        const activeTemplate = templates[template];
        let promptsForGeneration;
        if (template === 'hairStyler') {
            const selectedPrompts = activeTemplate.prompts.filter(p => selectedHairStyles.includes(p.id));
            if (isCustomHairActive && customHairStyle.trim() !== '') {
                selectedPrompts.push({ id: customHairStyle, base: customHairStyle });
            }
            promptsForGeneration = selectedPrompts;
        } else {
            promptsForGeneration = activeTemplate.prompts;
        }
    
        const prompt = promptsForGeneration[imageIndex];
        if (!prompt) {
            setError("Could not find the prompt to regenerate.");
            setGeneratedImages(prev => prev.map((img, index) => index === imageIndex ? { ...img, status: 'failed' } : img));
            return;
        }
    
        try {
            if (template === 'eightiesMall' && !currentAlbumStyle) {
                throw new Error("Cannot regenerate without an album style. Please start over.");
            }
            if (template === 'styleLookbook' && (lookbookStyle === '' || (lookbookStyle === 'Other' && customLookbookStyle.trim() === ''))) {
                throw new Error("Please choose or enter a fashion style for your lookbook!");
            }
            if (template === 'hairStyler' && (selectedHairStyles.length === 0 && (!isCustomHairActive || customHairStyle.trim() === ''))) {
                throw new Error("Please select at least one hairstyle to generate!");
            }
    
            const imageWithoutPrefix = uploadedImage.split(',')[1];
            const modelInstruction = getModelInstruction(template, prompt, {
                headshotExpression, headshotPose,
                currentAlbumStyle,
                lookbookStyle, customLookbookStyle,
                hairColors,
            });
            
            const payload = {
                contents: [{
                    parts: [
                        { text: modelInstruction },
                        { inlineData: { mimeType: "image/png", data: imageWithoutPrefix } }
                    ]
                }],
            };
    
            const imageUrl = await generateImageWithRetry(payload);
    
            setGeneratedImages(prev => prev.map((img, index) =>
                index === imageIndex ? { ...img, status: 'success', imageUrl } : img
            ));
    
        } catch (err) {
            console.error(`Regeneration failed for ${prompt.id}:`, err);
            setError(`Oops! Regeneration for "${prompt.id}" failed. Please try again.`);
            setGeneratedImages(prev => prev.map((img, index) =>
                index === imageIndex ? { ...img, status: 'failed' } : img
            ));
        }
    };
    
    const handleImageUpload = async (event) => {
        const file = event.target.files[0];
        if (file) {
            setIsUploading(true);
            setError(null);
            try {
                const base64Image = await toBase64(file);
                setUploadedImage(base64Image);
                setGeneratedImages([]); 
            } catch (err) {
                console.error("Error during image upload:", err);
                setError("That image couldn't be processed. Please try another file.");
            } finally {
                setIsUploading(false);
            }
        }
    };
    
    const handleCaptureConfirm = (imageDataUrl) => {
        setUploadedImage(imageDataUrl);
        setGeneratedImages([]);
        setError(null);
    };

    const handleGenerateClick = async () => {
        if (!uploadedImage) {
            setError("Please upload a photo to get started!");
            return;
        }

        if (!template) {
            setError("Please select a theme!");
            return;
        }
        
        if (template === 'styleLookbook' && (lookbookStyle === '' || (lookbookStyle === 'Other' && customLookbookStyle.trim() === ''))) {
            setError("Please choose or enter a fashion style for your lookbook!");
            return;
        }
        if (template === 'hairStyler' && selectedHairStyles.length === 0 && (!isCustomHairActive || customHairStyle.trim() === '')) {
            setError("Please select at least one hairstyle to generate!");
            return;
        }
        if (template === 'hairStyler' && isCustomHairActive && customHairStyle.trim() === '') {
            setError("Please enter your custom hairstyle or deselect 'Other...'");
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedImages([]);
        
        setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

        const imageWithoutPrefix = uploadedImage.split(',')[1];
        const activeTemplate = templates[template];

        let dynamicStyleForAlbum = '';
        if (template === 'eightiesMall') {
            setIsSettingUp(true);
            try {
                dynamicStyleForAlbum = await generateDynamicPrompt("A specific, creative, and detailed style for an 80s mall portrait studio photoshoot.");
                setCurrentAlbumStyle(dynamicStyleForAlbum);
            } catch(e) {
                setError("We couldn't generate a photoshoot style. Please try again.");
                setIsLoading(false);
                setIsSettingUp(false);
                return;
            }
            setIsSettingUp(false);
        } else {
            setCurrentAlbumStyle(''); 
        }

        let promptsForGeneration;
        if (template === 'hairStyler') {
            const selectedPrompts = activeTemplate.prompts.filter(p => selectedHairStyles.includes(p.id));
            if (isCustomHairActive && customHairStyle.trim() !== '') {
                selectedPrompts.push({ id: customHairStyle, base: customHairStyle });
            }
            promptsForGeneration = selectedPrompts;
        } else {
            promptsForGeneration = activeTemplate.prompts;
        }


        if (!promptsForGeneration || promptsForGeneration.length === 0) {
            setError("There was an issue preparing the creative ideas. Please try again.");
            setIsLoading(false);
            return;
        }

        const initialPlaceholders = promptsForGeneration.map(p => ({
            id: p.id,
            status: 'pending',
            imageUrl: null,
        }));
        setGeneratedImages(initialPlaceholders);

        for (let i = 0; i < promptsForGeneration.length; i++) {
            const p = promptsForGeneration[i];
            try {
                const modelInstruction = getModelInstruction(template, p, {
                    headshotExpression, headshotPose,
                    currentAlbumStyle: dynamicStyleForAlbum,
                    lookbookStyle, customLookbookStyle,
                    hairColors,
                });
                
                const payload = {
                    contents: [{
                        parts: [
                            { text: modelInstruction },
                            { inlineData: { mimeType: "image/png", data: imageWithoutPrefix } }
                        ]
                    }],
                };

                const imageUrl = await generateImageWithRetry(payload);

                setGeneratedImages(prev => prev.map((img, index) => 
                    index === i ? { ...img, status: 'success', imageUrl } : img
                ));

            } catch (err) {
                console.error(`Failed to generate image for ${p.id} after all retries:`, err);
                setGeneratedImages(prev => prev.map((img, index) =>
                    index === i ? { ...img, status: 'failed' } : img
                ));
            }
        }

        setIsLoading(false);
    };

    const triggerDownload = async (href, fileName) => {
        try {
            const response = await fetch(href);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(link);
        } catch (error) {
            console.error("Could not download the image:", error);
            setError("Sorry, the download failed. Please try again.");
        }
    };

    const handleDownloadRequest = async (imageUrl, era, ratio) => {
        const fileName = `picture-me-${era.toLowerCase().replace(/\s+/g, '-')}-${ratio.replace(':', 'x')}.png`;
        try {
            const shouldAddLabel = !['headshots', 'eightiesMall', 'styleLookbook', 'figurines'].includes(template);
            const framedImageUrl = await createSingleFramedImage(imageUrl, ratio, shouldAddLabel ? era : null);
            await triggerDownload(framedImageUrl, fileName);
        } catch (err) {
            console.error(`Failed to create framed image for download:`, err);
            setError(`Could not prepare that image for download. Please try again.`);
        }
    };


    const handleAlbumDownloadRequest = async (ratio) => {
        if (isDownloadingAlbum) return;
        setIsDownloadingAlbum(true);
        setError(null);

        try {
            const successfulImages = generatedImages.filter(img => img.status === 'success');
            if (successfulImages.length === 0) {
                setError("There are no successful images to include in an album.");
                setIsDownloadingAlbum(false);
                return;
            }

            let albumTitle = "My PictureMe Album";
            switch (template) {
                case 'decades': albumTitle = "Picture Me Through the Decades"; break;
                case 'styleLookbook': albumTitle = "Picture Me in my Style Lookbook"; break;
                case 'headshots': albumTitle = "Picture Me: Professional Headshots"; break;
                case 'eightiesMall': albumTitle = "Picture Me at the '80s Mall"; break;
                case 'impossibleSelfies': albumTitle = "Picture Me in Impossible Selfies"; break;
                case 'hairStyler': albumTitle = "Picture Me with New Hairstyles"; break;
                case 'figurines': albumTitle = "My Miniature Me Collection"; break;
            }


            const shouldAddLabel = !['headshots', 'eightiesMall', 'styleLookbook', 'figurines'].includes(template);

            const croppedImageUrls = await Promise.all(
                successfulImages.map(img => cropImage(img.imageUrl, ratio))
            );

            const imagesToStitch = await Promise.all(
                croppedImageUrls.map((url, index) => new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.src = url;
                    img.onload = () => {
                        if (shouldAddLabel) {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            const bottomPadding = img.width * 0.14;
                            canvas.width = img.width;
                            canvas.height = img.height + bottomPadding;
                            
                            ctx.drawImage(img, 0, 0);

                            const labelFontSize = Math.max(24, Math.floor(img.width * 0.08));
                            ctx.font = `700 ${labelFontSize}px Caveat, cursive`;
                            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(successfulImages[index].id, canvas.width / 2, img.height + bottomPadding / 2);

                            const finalImage = new Image();
                            finalImage.crossOrigin = "anonymous";
                            finalImage.src = canvas.toDataURL('image/png');
                            finalImage.onload = () => resolve(finalImage);
                            finalImage.onerror = reject;
                        } else {
                            resolve(img);
                        }
                    };
                    img.onerror = reject;
                }))
            );

            if (imagesToStitch.length === 0) throw new Error("No images to create an album.");
            
            const stitchCanvas = document.createElement('canvas');
            const stitchCtx = stitchCanvas.getContext('2d');

            const cols = imagesToStitch.length > 4 ? 3 : 2;
            const rows = Math.ceil(imagesToStitch.length / cols);
            const imageWidth = imagesToStitch[0].width;
            const imageHeight = imagesToStitch[0].height;
            const padding = Math.floor(imageWidth * 0.05);

            stitchCanvas.width = (cols * imageWidth) + ((cols + 1) * padding);
            stitchCanvas.height = (rows * imageHeight) + ((rows + 1) * padding);
            
            stitchCtx.fillStyle = '#FFFFFF';
            stitchCtx.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

            imagesToStitch.forEach((img, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                stitchCtx.drawImage(img, padding + col * (imageWidth + padding), padding + row * (imageHeight + padding), imageWidth, imageHeight);
            });
            
            const finalCanvas = document.createElement('canvas');
            const finalCtx = finalCanvas.getContext('2d');
            
            const outerPadding = stitchCanvas.width * 0.05;
            const titleFontSize = Math.max(48, Math.floor(stitchCanvas.width * 0.07));
            const footerFontSize = Math.max(24, Math.floor(stitchCanvas.width * 0.025));
            const titleSpacing = titleFontSize * 1.5;
            const footerSpacing = footerFontSize * 4.0;

            finalCanvas.width = stitchCanvas.width + outerPadding * 2;
            finalCanvas.height = stitchCanvas.height + outerPadding * 2 + titleSpacing + footerSpacing;

            finalCtx.fillStyle = '#111827';
            finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

            finalCtx.font = `700 ${titleFontSize}px Caveat, cursive`;
            finalCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
            finalCtx.textAlign = 'center';
            finalCtx.textBaseline = 'middle';
            finalCtx.fillText(albumTitle, finalCanvas.width / 2, outerPadding + titleSpacing / 2);

            finalCtx.drawImage(stitchCanvas, outerPadding, outerPadding + titleSpacing);

            finalCtx.font = `600 ${footerFontSize}px Inter, sans-serif`;
            finalCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
            finalCtx.textAlign = 'center';
            finalCtx.textBaseline = 'middle';
            finalCtx.fillText("Made with Gemini", finalCanvas.width / 2, finalCanvas.height - footerSpacing * 0.66);

            const nanoFooterFontSize = Math.max(18, Math.floor(stitchCanvas.width * 0.022));
            finalCtx.font = `600 ${nanoFooterFontSize}px Inter, sans-serif`;
            finalCtx.fillText("Edit your images with Nano Banana at gemini.google", finalCanvas.width / 2, finalCanvas.height - footerSpacing * 0.33);


            await triggerDownload(finalCanvas.toDataURL('image/png'), `picture-me-album-${ratio.replace(':', 'x')}.png`);
        } catch (err) {
            console.error("Failed to create or download album:", err);
            setError("Sorry, the album download failed. Please try again.");
        } finally {
            setIsDownloadingAlbum(false);
        }
    };
    
    const handleTemplateSelect = (templateId) => {
        setTemplate(templateId);
        setHeadshotExpression('Friendly Smile');
        setHeadshotPose('Forward');
        setLookbookStyle('');
        setCustomLookbookStyle('');
        setHairColors([]);
        setSelectedHairStyles([]);
        setCustomHairStyle('');
        setIsCustomHairActive(false);
    };

    const handleStartOver = () => {
        setGeneratedImages([]);
        setUploadedImage(null);
        setError(null);
        setTemplate(null);
        handleTemplateSelect(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    

    const AlbumDownloadButton = () => {
        const [isOpen, setIsOpen] = useState(false);
        const menuRef = useRef(null);

        useEffect(() => {
            const handleClickOutside = (event) => {
                if (menuRef.current && !menuRef.current.contains(event.target)) {
                    setIsOpen(false);
                }
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => {
                document.removeEventListener("mousedown", handleClickOutside);
            };
        }, [menuRef]);
        
        const handleButtonClick = () => {
            setIsOpen(!isOpen);
        };

        return (
             React.createElement('div', { className: "relative", ref: menuRef },
                React.createElement(Button, { primary: true, disabled: isDownloadingAlbum, onClick: handleButtonClick },
                    isDownloadingAlbum ? (
                        React.createElement('div', { className: "flex items-center justify-center gap-2" },
                            React.createElement('div', { className: "animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-black" }),
                            React.createElement('span', null, "Preparing...")
                        )
                    ) : (
                         React.createElement('div', { className: "flex items-center gap-2" },
                            React.createElement(IconDownload, null),
                            React.createElement('span', null, "Download Album")
                        )
                    )
                ),
                isOpen && !isDownloadingAlbum && (
                    React.createElement(motion.div, {
                        initial: { opacity: 0, scale: 0.95, y: 10 },
                        animate: { opacity: 1, scale: 1, y: 0 },
                        transition: { duration: 0.1 },
                        className: "absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-20"
                    },
                       React.createElement('div', { className: "bg-black/80 backdrop-blur-lg rounded-xl text-white text-sm flex flex-col items-start p-1 shadow-2xl w-48 border border-gray-700" },
                           React.createElement('button', { onClick: () => { handleAlbumDownloadRequest('1:1'); setIsOpen(false); }, className: "w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors" }, "Square (1:1)"),
                           React.createElement('button', { onClick: () => { handleAlbumDownloadRequest('9:16'); setIsOpen(false); }, className: "w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors" }, "Portrait (9:16)")
                       )
                    )
                )
            )
        );
    };

    const progress = generatedImages.length > 0
        ? (generatedImages.filter(img => img.status !== 'pending').length / generatedImages.length) * 100
        : 0;

    const totalSelectedStyles = selectedHairStyles.length + (isCustomHairActive ? 1 : 0);

    
    return (
        React.createElement(React.Fragment, null,
            React.createElement(CameraModal, {
                isOpen: isCameraOpen,
                onClose: () => setIsCameraOpen(false),
                onCapture: handleCaptureConfirm
            }),
            React.createElement('div', { className: "bg-black text-gray-200 min-h-screen flex flex-col items-center p-4 pb-20" },
                React.createElement(ErrorNotification, { message: error, onDismiss: () => setError(null) }),
                React.createElement('div', { className: "w-full max-w-6xl mx-auto" },
                    React.createElement('header', { className: "text-center my-12" },
                        React.createElement('h1', { className: "text-6xl md:text-7xl font-caveat text-white tracking-tight" },
                            "Picture", React.createElement('span', { className: "text-yellow-400" }, "Me")
                        ),
                        React.createElement('p', { className: "mt-4 text-lg text-gray-500" }, "Transform your photos with the power of Gemini AI.")
                    ),
                    React.createElement('main', null,
                        React.createElement('div', { className: "bg-gray-900/50 backdrop-blur-sm p-8 rounded-2xl shadow-2xl border border-gray-800 mb-16" },
                            React.createElement('div', { className: "grid grid-cols-1 lg:grid-cols-2 gap-10" },
                                React.createElement('div', null,
                                    React.createElement('h2', { className: "text-2xl font-semibold mb-6 text-white" }, "1. Your Photo"),
                                    React.createElement('div', {
                                        className: "w-full aspect-square border-4 border-dashed border-gray-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-yellow-400 transition-colors bg-gray-800 overflow-hidden shadow-inner",
                                        onClick: () => !uploadedImage && fileInputRef.current && fileInputRef.current.click()
                                    },
                                        isUploading ? (
                                            React.createElement('div', { className: "flex flex-col items-center" },
                                                React.createElement('div', { className: "animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-400" }),
                                                React.createElement('p', { className: "text-gray-400 mt-4" }, "Uploading...")
                                            )
                                        ) : uploadedImage ? (
                                            React.createElement('img', { src: uploadedImage, alt: "Uploaded preview", className: "w-full h-full object-cover" })
                                        ) : (
                                            React.createElement('div', { className: "flex flex-col items-center justify-center p-6 text-center text-gray-500" },
                                                React.createElement(IconUpload, null),
                                                React.createElement('p', { className: "mt-4 text-lg text-gray-300" }, "Click to upload a file"),
                                                React.createElement('p', { className: "mt-4 text-sm" }, "or"),
                                                React.createElement(Button, {
                                                    onClick: (e) => {
                                                        e.stopPropagation();
                                                        setIsCameraOpen(true);
                                                    },
                                                    className: "mt-2"
                                                },
                                                    React.createElement('div', { className: "flex items-center gap-2" },
                                                        React.createElement(IconCamera, null),
                                                        React.createElement('span', null, "Use Camera")
                                                    )
                                                )
                                            )
                                        )
                                    ),
                                    uploadedImage && !isUploading && (
                                        React.createElement('div', { className: "flex flex-col sm:flex-row gap-4 mt-4 w-full" },
                                            React.createElement(Button, { onClick: () => fileInputRef.current && fileInputRef.current.click(), className: "flex-1" }, "Change File"),
                                            React.createElement(Button, { onClick: () => setIsCameraOpen(true), className: "flex-1" },
                                                React.createElement('div', { className: "flex items-center justify-center gap-2" },
                                                    React.createElement(IconCamera, null),
                                                    React.createElement('span', null, "Use Camera")
                                                )
                                            )
                                        )
                                    ),
                                     React.createElement('input', { type: "file", ref: fileInputRef, onChange: handleImageUpload, accept: "image/png, image/jpeg", className: "hidden" })
                                ),
                                React.createElement('div', null,
                                     React.createElement('h2', { className: "text-2xl font-semibold mb-6 text-white" }, "2. Choose a Theme"),
                                     React.createElement('div', { className: "grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8" },
                                        Object.entries(templates).map(([key, data]) => (
                                            React.createElement(TemplateCard, {
                                                key: key,
                                                id: key,
                                                name: data.name,
                                                icon: data.icon,
                                                description: data.description,
                                                isSelected: template === key,
                                                onSelect: handleTemplateSelect
                                            })
                                        ))
                                     ),
                                     template === 'hairStyler' && (
                                        React.createElement(motion.div, {
                                            initial: { opacity: 0, height: 0 },
                                            animate: { opacity: 1, height: 'auto' },
                                            transition: { duration: 0.3 },
                                            className: "p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50"
                                        },
                                            React.createElement('div', { className: "flex justify-between items-center" },
                                                React.createElement('h3', { className: 'text-xl font-semibold text-white' }, "Customize Hairstyle"),
                                                 React.createElement('span', { className: `text-sm font-bold ${totalSelectedStyles >= 6 ? 'text-yellow-400' : 'text-gray-500'}` }, `${totalSelectedStyles} / 6`)
                                            ),
                                            React.createElement('div', null,
                                                React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-3" }, "Style (select up to 6)"),
                                                React.createElement('div', { className: "flex flex-wrap gap-3" },
                                                    templates.hairStyler.prompts.map(prompt => (
                                                        React.createElement('button', {
                                                            key: prompt.id,
                                                            onClick: () => handleHairStyleSelect(prompt.id),
                                                            className: `cursor-pointer px-3 py-1.5 text-sm rounded-full transition-colors font-semibold 
                                                                ${selectedHairStyles.includes(prompt.id) ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`
                                                        }, prompt.id)
                                                    )),
                                                    React.createElement('button', {
                                                        onClick: () => handleHairStyleSelect('Other'),
                                                        className: `cursor-pointer px-3 py-1.5 text-sm rounded-full transition-colors font-semibold 
                                                            ${isCustomHairActive ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`
                                                    }, "Other...")
                                                )
                                            ),
                                            isCustomHairActive && (
                                                React.createElement(motion.div, {
                                                    initial: { opacity: 0, y: -10 },
                                                    animate: { opacity: 1, y: 0 }
                                                },
                                                    React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-2" }, "Your Custom Style"),
                                                    React.createElement('input', {
                                                        type: "text",
                                                        placeholder: "e.g., A vibrant pink mohawk",
                                                        value: customHairStyle,
                                                        onChange: (e) => setCustomHairStyle(e.target.value),
                                                        className: "w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white"
                                                    })
                                                )
                                            ),
                                            React.createElement('div', null,
                                                React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-3" }, "Hair Color"),
                                                React.createElement('div', { className: "flex items-center gap-4 flex-wrap" },
                                                    hairColors.map((color, index) => (
                                                        React.createElement(motion.div, {
                                                            key: index,
                                                            initial: { opacity: 0, scale: 0.8 },
                                                            animate: { opacity: 1, scale: 1 },
                                                            className: "flex items-center gap-2 p-2 bg-gray-700/50 rounded-lg border border-gray-600"
                                                        },
                                                            React.createElement('div', { className: "relative w-10 h-10 rounded-md overflow-hidden", style: { backgroundColor: color } },
                                                                React.createElement('input', {
                                                                    type: "color",
                                                                    value: color,
                                                                    onChange: (e) => handleColorChange(index, e.target.value),
                                                                    className: "absolute inset-0 w-full h-full cursor-pointer opacity-0"
                                                                })
                                                            ),
                                                            React.createElement('span', { className: "font-mono text-sm text-gray-300 uppercase" }, color),
                                                            React.createElement('button', {
                                                                onClick: () => removeHairColor(index),
                                                                className: "p-1 rounded-full text-gray-500 hover:bg-gray-600 hover:text-red-400 transition-colors",
                                                                'aria-label': "Remove color"
                                                            }, React.createElement(IconX, null))
                                                        )
                                                    )),
                                                    hairColors.length < 2 && (
                                                        React.createElement('button', {
                                                            onClick: addHairColor,
                                                            className: "flex items-center justify-center gap-2 h-[68px] px-4 rounded-lg border-2 border-dashed border-gray-600 hover:border-yellow-400 text-gray-400 hover:text-yellow-400 transition-colors bg-gray-700/30"
                                                        },
                                                            React.createElement(IconPlus, null),
                                                            React.createElement('span', null, hairColors.length === 0 ? 'Add Color' : 'Add Highlight')
                                                        )
                                                    )
                                                ),
                                                hairColors.length > 0 && (
                                                     React.createElement('button', { onClick: () => setHairColors([]), className: "text-xs text-gray-500 hover:text-white transition-colors mt-3" }, "Clear all colors")
                                                )
                                            )
                                        )
                                     ),
                                     template === 'headshots' && (
                                        React.createElement(motion.div, {
                                            initial: { opacity: 0, height: 0 },
                                            animate: { opacity: 1, height: 'auto' },
                                            transition: { duration: 0.3 },
                                            className: "p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50"
                                        },
                                            React.createElement('h3', { className: 'text-xl font-semibold text-white' }, "Customize Headshot"),
                                            React.createElement('div', null,
                                                React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-3" }, "Facial Expression"),
                                                React.createElement('div', { className: "flex flex-wrap gap-3" },
                                                    React.createElement(RadioPill, { name: "expression", value: "Friendly Smile", label: "Friendly Smile", checked: headshotExpression === 'Friendly Smile', onChange: e => setHeadshotExpression(e.target.value) }),
                                                    React.createElement(RadioPill, { name: "expression", value: "Confident Look", label: "Confident Look", checked: headshotExpression === 'Confident Look', onChange: e => setHeadshotExpression(e.target.value) }),
                                                    React.createElement(RadioPill, { name: "expression", value: "Thoughtful Gaze", label: "Thoughtful Gaze", checked: headshotExpression === 'Thoughtful Gaze', onChange: e => setHeadshotExpression(e.target.value) })
                                                )
                                            ),
                                             React.createElement('div', null,
                                                React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-3" }, "Pose"),
                                                 React.createElement('div', { className: "flex flex-wrap gap-3" },
                                                    React.createElement(RadioPill, { name: "pose", value: "Forward", label: "Facing Forward", checked: headshotPose === 'Forward', onChange: e => setHeadshotPose(e.target.value) }),
                                                    React.createElement(RadioPill, { name: "pose", value: "Angle", label: "Slight Angle", checked: headshotPose === 'Angle', onChange: e => setHeadshotPose(e.target.value) })
                                                )
                                            )
                                         )
                                     ),
                                     template === 'styleLookbook' && (
                                        React.createElement(motion.div, {
                                            initial: { opacity: 0, height: 0 },
                                            animate: { opacity: 1, height: 'auto' },
                                            transition: { duration: 0.3 },
                                            className: "p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50"
                                        },
                                            React.createElement('h3', { className: 'text-xl font-semibold text-white' }, "Choose a Fashion Style"),
                                            React.createElement('div', null,
                                                React.createElement('div', { className: "flex flex-wrap gap-3" },
                                                    templates.styleLookbook.styles.map(style => (
                                                        React.createElement(RadioPill, { 
                                                            key: style,
                                                            name: "style", 
                                                            value: style, 
                                                            label: style, 
                                                            checked: lookbookStyle === style, 
                                                            onChange: e => {
                                                                setLookbookStyle(e.target.value);
                                                                setCustomLookbookStyle('');
                                                            }
                                                        })
                                                    )),
                                                    React.createElement(RadioPill, {
                                                        name: "style",
                                                        value: "Other",
                                                        label: "Other...",
                                                        checked: lookbookStyle === 'Other',
                                                        onChange: e => setLookbookStyle(e.target.value)
                                                    })
                                                )
                                            ),
                                            lookbookStyle === 'Other' && (
                                                React.createElement(motion.div, {
                                                    initial: { opacity: 0, y: -10 },
                                                    animate: { opacity: 1, y: 0 }
                                                },
                                                    React.createElement('label', { className: "block text-sm font-medium text-gray-400 mb-2" }, "Your Custom Style"),
                                                    React.createElement('input', {
                                                        type: "text",
                                                        placeholder: "e.g., Cyberpunk, Avant-garde",
                                                        value: customLookbookStyle,
                                                        onChange: (e) => setCustomLookbookStyle(e.target.value),
                                                        className: "w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white"
                                                    })
                                                )
                                            )
                                        )
                                     )
                                )
                            ),
                            React.createElement('div', { className: "mt-12 text-center" },
                                 React.createElement(Button, {
                                    onClick: handleGenerateClick,
                                    disabled: !uploadedImage || !template || isLoading || isUploading || isSettingUp,
                                    primary: true,
                                    className: "text-lg px-12 py-4"
                                 },
                                    React.createElement('div', { className: "flex items-center gap-3" },
                                        isLoading || isSettingUp ? (
                                            React.createElement(React.Fragment, null,
                                                React.createElement('div', { className: "animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-black" }),
                                                isSettingUp ? "Setting the stage..." : `Generating... (${Math.round(progress)}%)`
                                            )
                                        ) : (
                                            React.createElement(React.Fragment, null,
                                                React.createElement(IconSparkles, null),
                                                "Generate Photos"
                                            )
                                        )
                                    )
                                 )
                            )
                        ),
                        React.createElement('div', { ref: resultsRef },
                            isSettingUp && (
                                React.createElement('div', { className: "text-center my-20 flex flex-col items-center p-10 bg-gray-900/70 rounded-2xl" },
                                    React.createElement('div', { className: "animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-pink-500 mb-6" }),
                                    React.createElement('p', { className: "text-2xl text-pink-400 font-semibold tracking-wider italic" }, "Teasing our hair and firing up the lasers..."),
                                    React.createElement('p', { className: "text-gray-400 mt-2" }, "Generating a totally tubular '80s photoshoot style!")
                                )
                            ),
                            (isLoading || generatedImages.length > 0) && !isSettingUp && (
                                React.createElement('div', { className: "mt-16" },
                                    React.createElement('h2', { className: "text-3xl font-bold text-white mb-8 text-center" }, "Your Generated Photos"),
                                    isLoading && (
                                        React.createElement('div', { className: "w-full max-w-4xl mx-auto mb-8 text-center" },
                                            React.createElement('div', { className: "bg-gray-800 rounded-full h-3 overflow-hidden shadow-md" },
                                                React.createElement(motion.div, {
                                                    className: "bg-yellow-400 h-3 rounded-full",
                                                    initial: { width: 0 },
                                                    animate: { width: `${progress}%` },
                                                    transition: { duration: 0.5 }
                                                })
                                            ),
                                            React.createElement('p', { className: "text-gray-400 mt-4 text-sm" }, "Please keep this window open while your photos are being generated.")
                                        )
                                    ),
                                     React.createElement('div', { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10 mt-8" },
                                        generatedImages.map((img, index) => {
                                            const activeTemplate = templates[template] || {};
                                            const isPolaroid = activeTemplate.isPolaroid;
                                            const showLabel = !['headshots', 'eightiesMall', 'styleLookbook', 'figurines'].includes(template);
                                            
                                            switch (img.status) {
                                                case 'success':
                                                    return React.createElement(PhotoDisplay, {
                                                        key: `${img.id}-${index}-success`,
                                                        era: img.id,
                                                        imageUrl: img.imageUrl,
                                                        onDownload: handleDownloadRequest,
                                                        onRegenerate: () => regenerateImageAtIndex(index),
                                                        isPolaroid: isPolaroid,
                                                        index: index,
                                                        showLabel: showLabel
                                                    });
                                                case 'failed':
                                                    return React.createElement(ErrorCard, {
                                                        key: `${img.id}-${index}-failed`,
                                                        era: img.id,
                                                        isPolaroid: isPolaroid,
                                                        onRegenerate: () => regenerateImageAtIndex(index),
                                                        showLabel: showLabel
                                                    });
                                                case 'pending':
                                                default:
                                                    return React.createElement(LoadingCard, { 
                                                        key: `${img.id}-${index}-pending`, 
                                                        era: img.id, 
                                                        isPolaroid: isPolaroid,
                                                        showLabel: showLabel });
                                            }
                                        })
                                    ),
                                    React.createElement('p', { className: "text-center text-xs text-gray-600 mt-8" }, "Made with Gemini")
                                )
                            ),
                            !isLoading && generatedImages.length > 0 && (
                                React.createElement('div', { className: "text-center mt-16 mb-12 flex justify-center gap-6" },
                                    React.createElement(Button, { onClick: handleStartOver }, "Start Over"),
                                    React.createElement(AlbumDownloadButton, null)
                                )
                            )
                        )
                    )
                )
            )
        )
    );
};

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(React.createElement(App));
